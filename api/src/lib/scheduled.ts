import { Env } from '../index';
import { getLogiwaCredentials, getTenantLogiwaConfig, getShipmentOrderWithShipments, queryInventory, logiwaFetch, LogiwaCredentials } from './logiwa';
import { syncSftpInbound, syncSftpConfirmations } from './sftp';
import { pushAfterShipTrackings } from './aftership';

// Heartbeat wrapper: records each cron's last run + outcome in cron_runs so the
// portal can show whether jobs are alive. Errors are recorded (better visibility
// than an opaque runtime log) and not rethrown.
async function recordRun(env: Env, cron: string, fn: () => Promise<void>): Promise<void> {
  let status = 'ok';
  let detail: string | null = null;
  try {
    await fn();
  } catch (err) {
    status = 'error';
    detail = err instanceof Error ? err.message : String(err);
    console.error(`[cron:${cron}] failed:`, detail);
  } finally {
    try {
      await env.DB.prepare(
        `INSERT INTO cron_runs (cron, last_run_at, last_status, detail)
         VALUES (?, datetime('now'), ?, ?)
         ON CONFLICT(cron) DO UPDATE SET last_run_at = datetime('now'), last_status = excluded.last_status, detail = excluded.detail`
      ).bind(cron, status, detail).run();
    } catch (hbErr) {
      console.error(`[cron:${cron}] heartbeat write failed:`, hbErr);
    }
  }
}

export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  switch (event.cron) {
    case '*/15 * * * *':
      await recordRun(env, 'tracking-sync', async () => {
        // Cheap detector first: one list call per environment finds anything
        // that shipped recently and nudges matching orders to the front of the
        // queue, so the per-order flipper below confirms them THIS pass instead
        // of hours from now (the standing 'sent' population makes the plain
        // rotation take ~4-5h per full cycle).
        try { await sweepRecentShipments(env); } catch (e) { console.error('[sweep] failed:', e); }
        await syncTracking(env);
      });
      break;

    case '0 * * * *':
      await recordRun(env, 'inventory-refresh', () => refreshInventoryCache(env));
      break;

    case '*/2 * * * *':
      // SFTP connector — inbound file ingest + outbound confirmations.
      // Each half isolated so one failing can't abort the other; failures roll
      // up into the heartbeat detail.
      await recordRun(env, 'sftp-connector', async () => {
        const errs: string[] = [];
        try { await syncSftpInbound(env); } catch (e) { errs.push(`inbound: ${e instanceof Error ? e.message : e}`); }
        try { await syncSftpConfirmations(env); } catch (e) { errs.push(`confirmations: ${e instanceof Error ? e.message : e}`); }
        if (errs.length) throw new Error(errs.join(' | '));
      });
      // AfterShip pushes for enabled tenants — separate heartbeat, isolated.
      await recordRun(env, 'aftership-push', () => pushAfterShipTrackings(env));
      break;

    default:
      console.log(`Unknown cron: ${event.cron}`);
  }
}

async function getCredsForTenant(env: Env, tenantId: string): Promise<LogiwaCredentials | null> {
  const config = await getTenantLogiwaConfig(env, tenantId);
  return getLogiwaCredentials(env, config.environment, config.clientIdentifier);
}

// Detector: list recently-shipped orders in each Logiwa environment (1-3 calls
// per env, no per-order lookups, no client filter — order-stamped client ids
// are unreliable) and push any of OUR 'sent' orders that match to the front of
// the recheck queue. The regular syncTracking pass then flips them with its
// full logic (tracking, callbacks, confirmations) within the same run.
async function sweepRecentShipments(env: Env): Promise<void> {
  const d = (offsetDays: number) => {
    const t = new Date(Date.now() + offsetDays * 86_400_000);
    return t.toISOString().split('T')[0];
  };
  const range = `${d(-3)},${d(1)}`;

  for (const environment of ['sandbox', 'production'] as const) {
    const creds = getLogiwaCredentials(env, environment);
    if (!creds) continue;

    const shippedIds: string[] = [];
    try {
      for (let page = 0; page < 3; page++) {
        const res = await logiwaFetch(
          creds,
          'GET',
          `/v3.1/ShipmentOrder/list/i/${page}/s/200?ActualShipmentDate.bt=${range}`
        );
        const rows: any[] = res?.data || [];
        for (const r of rows) {
          if (r?.identifier) shippedIds.push(String(r.identifier).toLowerCase());
        }
        if (rows.length < 200) break;
      }
    } catch (e) {
      console.error(`[sweep] ${environment} list failed:`, e instanceof Error ? e.message : e);
      continue;
    }
    if (shippedIds.length === 0) continue;

    // Nudge matches to the queue front in chunks (D1 param limit safety).
    let nudged = 0;
    for (let i = 0; i < shippedIds.length; i += 40) {
      const chunk = shippedIds.slice(i, i + 40);
      const placeholders = chunk.map(() => '?').join(',');
      const r = await env.DB.prepare(
        `UPDATE orders SET updated_at = '2000-01-01 00:00:00'
         WHERE status = 'sent' AND lower(logiwa_order_id) IN (${placeholders})
           AND updated_at != '2000-01-01 00:00:00'`
      ).bind(...chunk).run();
      nudged += r.meta?.changes ?? 0;
    }
    if (nudged > 0) console.log(`[sweep] ${environment}: ${shippedIds.length} recent shipments, nudged ${nudged} orders to front`);
  }
}

async function syncTracking(env: Env): Promise<void> {
  const { results: orders } = await env.DB.prepare(
    `SELECT o.id, o.tenant_id, o.logiwa_order_id, o.external_order_id, o.environment, t.callback_url
     FROM orders o
     JOIN tenants t ON t.id = o.tenant_id
     WHERE o.status = 'sent' AND o.logiwa_order_id IS NOT NULL
     ORDER BY o.updated_at ASC
     LIMIT 50`
  ).all();

  console.log(`[syncTracking] picked ${orders?.length ?? 0} sent orders to check`);
  if (!orders || orders.length === 0) return;

  let fulfilledCount = 0;
  let closedCount = 0;
  let unchangedCount = 0;
  let errorCount = 0;

  // Group by tenant to reuse credentials
  const byTenant = new Map<string, any[]>();
  for (const order of orders) {
    const tid = order.tenant_id as string;
    if (!byTenant.has(tid)) byTenant.set(tid, []);
    byTenant.get(tid)!.push(order);
  }

  console.log(`[syncTracking] grouped into ${byTenant.size} tenants: ${[...byTenant.keys()].join(',')}`);
  for (const [tenantId, tenantOrders] of byTenant) {
    // Resolve credentials for BOTH environments up front. Orders are created
    // with the API key's environment, which can differ from the tenant default
    // (this mismatch is what left thousands of orders stuck at 'sent').
    const cfgSandbox = await getTenantLogiwaConfig(env, tenantId, 'sandbox');
    const cfgProd = await getTenantLogiwaConfig(env, tenantId, 'production');
    const credsByEnv: Record<string, LogiwaCredentials | null> = {
      sandbox: getLogiwaCredentials(env, 'sandbox', cfgSandbox.clientIdentifier),
      production: getLogiwaCredentials(env, 'production', cfgProd.clientIdentifier),
    };
    const tenantDefault = (await getTenantLogiwaConfig(env, tenantId)).environment;
    console.log(`[syncTracking] tenant=${tenantId} default=${tenantDefault} orders=${tenantOrders.length}`);

    // Adaptive hint: once we discover where this tenant's unknown-env orders
    // live, try that environment first for the rest of the run.
    let envHint: 'sandbox' | 'production' | null = null;

    for (const order of tenantOrders) {
      try {
        const known = order.environment === 'production' || order.environment === 'sandbox'
          ? (order.environment as 'sandbox' | 'production')
          : null;
        const first = known ?? envHint ?? tenantDefault;
        const tryEnvs: ('sandbox' | 'production')[] = known
          ? [known]
          : first === 'production' ? ['production', 'sandbox'] : ['sandbox', 'production'];

        let logiwaOrder: any = null;
        let foundEnv: 'sandbox' | 'production' | null = null;
        let creds: LogiwaCredentials | null = null;
        for (const e of tryEnvs) {
          const c = credsByEnv[e];
          if (!c) continue;
          logiwaOrder = await getShipmentOrderWithShipments(c, order.logiwa_order_id as string);
          if (logiwaOrder) { foundEnv = e; creds = c; break; }
        }

        if (!logiwaOrder) {
          unchangedCount++;
          await env.DB.prepare(
            `UPDATE orders SET updated_at = datetime('now') WHERE id = ?`
          ).bind(order.id).run();
          continue;
        }

        // Back-fill the discovered environment so this order (and, via the
        // hint, this tenant's queue) never needs the double lookup again.
        if (!known && foundEnv) {
          envHint = foundEnv;
          await env.DB.prepare(
            `UPDATE orders SET environment = ? WHERE id = ?`
          ).bind(foundEnv, order.id).run();
        }

        const logiwaStatus = logiwaOrder.shipmentOrderStatusName?.toLowerCase();
        const trackingNumbers = logiwaOrder.trackingNumbers || [];

        let newStatus: string | null = null;
        if (logiwaStatus === 'shipped' || trackingNumbers.length > 0) {
          newStatus = 'fulfilled';
        } else if (logiwaStatus === 'cancelled') {
          newStatus = 'closed';
        }

        if (newStatus) {
          await env.DB.prepare(
            `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`
          )
            .bind(newStatus, order.id)
            .run();
          if (newStatus === 'fulfilled') fulfilledCount++;
          else if (newStatus === 'closed') closedCount++;

          const callbackUrl = order.callback_url as string;
          if (callbackUrl && trackingNumbers.length > 0) {
            try {
              await fetch(callbackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  event: 'tracking_update',
                  orderId: order.id,
                  externalOrderId: order.external_order_id,
                  status: newStatus,
                  carrier: logiwaOrder.carrierName,
                  trackingNumbers,
                }),
              });
            } catch (err) {
              console.error(`Callback failed for order ${order.id}:`, err);
            }
          }
        } else {
          // Bump updated_at even when status didn't change so this order
          // moves to the back of the queue. Prevents head-of-line blocking
          // when the oldest sent orders sit in a Logiwa status we don't
          // map (e.g., 'planning', 'on hold', 'allocated').
          await env.DB.prepare(
            `UPDATE orders SET updated_at = datetime('now') WHERE id = ?`
          )
            .bind(order.id)
            .run();
          unchangedCount++;
          console.log(`[syncTracking] order ${order.id} unchanged: logiwaStatus=${logiwaOrder.shipmentOrderStatusName} tracking=${trackingNumbers.length}`);
        }
      } catch (err) {
        errorCount++;
        console.error(`Tracking sync failed for order ${order.id}:`, err);
      }
    }
  }

  console.log(`[syncTracking] done: fulfilled=${fulfilledCount} closed=${closedCount} unchanged=${unchangedCount} errors=${errorCount}`);
}

async function refreshInventoryCache(env: Env): Promise<void> {
  const { results: tenants } = await env.DB.prepare(
    `SELECT id FROM tenants WHERE active = 1`
  ).all();

  if (!tenants || tenants.length === 0) return;

  for (const tenant of tenants) {
    const tenantId = tenant.id as string;
    const creds = await getCredsForTenant(env, tenantId);
    if (!creds) continue;

    try {
      const { results: cachedSkus } = await env.DB.prepare(
        `SELECT sku FROM inventory_cache WHERE tenant_id = ?`
      )
        .bind(tenantId)
        .all();

      if (!cachedSkus || cachedSkus.length === 0) continue;

      const skus = cachedSkus.map((r: any) => r.sku as string);
      const items = await queryInventory(creds, skus);

      for (const item of items) {
        await env.DB.prepare(
          `INSERT INTO inventory_cache (tenant_id, sku, quantity, last_synced_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT (tenant_id, sku) DO UPDATE SET quantity = ?, last_synced_at = datetime('now')`
        )
          .bind(tenantId, item.productSku, item.availableQuantity, item.availableQuantity)
          .run();
      }
    } catch (err) {
      console.error(`Inventory refresh failed for tenant ${tenantId}:`, err);
    }
  }
}
