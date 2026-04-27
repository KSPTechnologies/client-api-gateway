import { Env } from '../index';
import { getLogiwaCredentials, getTenantLogiwaConfig, getShipmentOrder, queryInventory, LogiwaCredentials } from './logiwa';

export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  switch (event.cron) {
    case '*/15 * * * *':
      await syncTracking(env);
      break;

    case '0 * * * *':
      await refreshInventoryCache(env);
      break;

    default:
      console.log(`Unknown cron: ${event.cron}`);
  }
}

async function getCredsForTenant(env: Env, tenantId: string): Promise<LogiwaCredentials | null> {
  const config = await getTenantLogiwaConfig(env, tenantId);
  return getLogiwaCredentials(env, config.environment, config.clientIdentifier);
}

async function syncTracking(env: Env): Promise<void> {
  const { results: orders } = await env.DB.prepare(
    `SELECT o.id, o.tenant_id, o.logiwa_order_id, o.external_order_id, t.callback_url
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
    const config = await getTenantLogiwaConfig(env, tenantId);
    const creds = getLogiwaCredentials(env, config.environment, config.clientIdentifier);
    console.log(`[syncTracking] tenant=${tenantId} env=${config.environment} clientId=${config.clientIdentifier ?? 'NONE'} credsOk=${!!creds} orders=${tenantOrders.length}`);
    if (!creds) continue;

    for (const order of tenantOrders) {
      try {
        const logiwaOrder = await getShipmentOrder(creds, order.logiwa_order_id as string);
        if (!logiwaOrder) continue;

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
