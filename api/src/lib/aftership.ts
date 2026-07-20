import { Env } from '../index';
import { getLogiwaCredentials, getTenantLogiwaConfig, getShipmentOrderWithShipments } from './logiwa';

/**
 * AfterShip connector: when an order for an AfterShip-enabled tenant flips to
 * 'fulfilled', create a tracking in the tenant's AfterShip account so their
 * customers can track shipments.
 *
 * The payload mirrors what Pivot Health's previous WMS pushed (verified against
 * their live AfterShip records): flat body, order_id = the client's own order
 * id, custom_fields carrying custom_webhook_secret / custom_address /
 * custom_lot. No customer PII (their old flow sent none).
 *
 * ADDITIVE: new file. Runs on the 2-minute cron with its own heartbeat.
 * Tenants without an aftership_accounts row are untouched.
 */

const AFTERSHIP_URL = 'https://api.aftership.com/tracking/2026-07/trackings';

interface AfterShipCreds {
  apiKey: string;
  webhookSecret?: string;
}

const SLUG_MAP: [RegExp, string][] = [
  [/usps/i, 'usps'],
  [/ups/i, 'ups'],
  [/fedex/i, 'fedex'],
  [/dhl/i, 'dhl'],
];

export async function pushAfterShipTrackings(env: Env): Promise<void> {
  const { results: orders } = await env.DB.prepare(
    `SELECT o.id, o.tenant_id, o.external_order_id, o.logiwa_order_id, o.environment, o.request_payload_key
     FROM orders o
     JOIN aftership_accounts a ON a.tenant_id = o.tenant_id AND a.enabled = 1
     WHERE o.status = 'fulfilled' AND o.logiwa_order_id IS NOT NULL
       AND o.updated_at >= a.enabled_at
       AND NOT EXISTS (SELECT 1 FROM aftership_pushes p WHERE p.order_id = o.id)
     ORDER BY o.updated_at ASC
     LIMIT 15`
  ).all();
  if (!orders || orders.length === 0) return;

  for (const row of orders as any[]) {
    try {
      const creds = (await env.KV.get(`aftership:${row.tenant_id}`, 'json')) as AfterShipCreds | null;
      if (!creds || !creds.apiKey) {
        await recordPush(env, row, '(none)', 'skipped', 'no AfterShip credentials in KV');
        continue;
      }

      // Look up tracking details from Logiwa in the order's own environment.
      const override = row.environment === 'production' || row.environment === 'sandbox' ? row.environment : undefined;
      const cfg = await getTenantLogiwaConfig(env, row.tenant_id, override);
      const lcreds = getLogiwaCredentials(env, cfg.environment, cfg.clientIdentifier);
      if (!lcreds) {
        await recordPush(env, row, '(none)', 'error', 'Logiwa credentials unavailable');
        continue;
      }
      const lo = await getShipmentOrderWithShipments(lcreds, row.logiwa_order_id as string);
      const trackingNumbers: string[] = (lo?.trackingNumbers || []).filter(Boolean);
      if (trackingNumbers.length === 0) {
        await recordPush(env, row, '(none)', 'error', 'fulfilled but no tracking numbers on Logiwa order');
        continue;
      }

      // Carrier slug — only when confidently recognizable; else AfterShip auto-detects.
      let slug: string | null = null;
      const carrier = String(lo.carrierName || '');
      for (const [re, s] of SLUG_MAP) {
        if (re.test(carrier)) { slug = s; break; }
      }

      // custom_address from the stored order request payload (best effort).
      let customAddress: string | null = null;
      try {
        const obj = row.request_payload_key ? await env.R2.get(row.request_payload_key as string) : null;
        if (obj) {
          const body = JSON.parse(await obj.text());
          const a = body?.shipmentAddress;
          if (a && a.addressLine1) {
            customAddress = [a.addressLine1, a.city, a.state, a.postalCode, a.country || 'US']
              .filter(Boolean).join(',');
          }
        }
      } catch { /* omit address rather than fail the push */ }

      // Lot/batch numbers from the shipment packages.
      const lots = Array.from(new Set(
        ((lo.shipmentInfo || []) as any[]).map((i) => i?.lotBatchNumber).filter(Boolean)
      ));

      for (const tn of trackingNumbers) {
        const pushId = crypto.randomUUID();
        const claim = await env.DB.prepare(
          `INSERT OR IGNORE INTO aftership_pushes (id, order_id, tenant_id, tracking_number, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`
        ).bind(pushId, row.id, row.tenant_id, tn).run();
        if (!claim.meta || claim.meta.changes === 0) continue; // already attempted

        const customFields: Record<string, string> = {};
        if (creds.webhookSecret) customFields.custom_webhook_secret = creds.webhookSecret;
        if (customAddress) customFields.custom_address = customAddress;
        if (lots.length) customFields.custom_lot = lots.join(',');

        const payload: Record<string, unknown> = {
          tracking_number: tn,
          order_id: row.external_order_id,
          custom_fields: customFields,
        };
        if (slug) payload.slug = slug;

        const res = await fetch(AFTERSHIP_URL, {
          method: 'POST',
          headers: { 'as-api-key': creds.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const bodyJson: any = await res.json().catch(() => ({}));

        // Persist what we sent (secret masked — secrets never land in D1) and
        // a compact view of what came back, for the portal drill-down.
        const storedPayload = JSON.stringify({
          ...payload,
          custom_fields: { ...(customFields as Record<string, string>), ...(creds.webhookSecret ? { custom_webhook_secret: '••• (masked)' } : {}) },
        });
        const responseMeta = JSON.stringify({
          httpStatus: res.status,
          meta: bodyJson?.meta ?? null,
          trackingId: bodyJson?.data?.id ?? bodyJson?.data?.tracking?.id ?? null,
        }).slice(0, 2000);

        if (res.ok) {
          await env.DB.prepare(
            `UPDATE aftership_pushes SET status='pushed', aftership_id=?, request_payload=?, response_meta=?, updated_at=datetime('now') WHERE id=?`
          ).bind(bodyJson?.data?.id ?? bodyJson?.data?.tracking?.id ?? null, storedPayload, responseMeta, pushId).run();
        } else if (res.status === 409 || /already exist/i.test(String(bodyJson?.meta?.message || ''))) {
          // Duplicate = someone already created it (e.g. old WMS overlap) — treat as done.
          await env.DB.prepare(
            `UPDATE aftership_pushes SET status='pushed', last_error='already existed in AfterShip', request_payload=?, response_meta=?, updated_at=datetime('now') WHERE id=?`
          ).bind(storedPayload, responseMeta, pushId).run();
        } else {
          await env.DB.prepare(
            `UPDATE aftership_pushes SET status='error', last_error=?, request_payload=?, response_meta=?, updated_at=datetime('now') WHERE id=?`
          ).bind(`HTTP ${res.status}: ${String(bodyJson?.meta?.message || '').slice(0, 180)}`, storedPayload, responseMeta, pushId).run();
        }
        console.log(`[aftership] ${row.external_order_id} / ${tn} -> HTTP ${res.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[aftership] order ${row.id} failed:`, msg);
      try { await recordPush(env, row, '(none)', 'error', msg); } catch { /* next run retries nothing; row visible */ }
    }
  }
}

async function recordPush(env: Env, row: any, tn: string, status: string, msg: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO aftership_pushes (id, order_id, tenant_id, tracking_number, status, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(crypto.randomUUID(), row.id, row.tenant_id, tn, status, msg).run();
}
