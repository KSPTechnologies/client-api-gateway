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

// ISO 3166 alpha-2 -> alpha-3 for the countries we ship to (AfterShip wants alpha-3).
const COUNTRY_A3: Record<string, string> = {
  US: 'USA', USA: 'USA', CA: 'CAN', CAN: 'CAN', MX: 'MEX', MEX: 'MEX',
  GB: 'GBR', GBR: 'GBR', AU: 'AUS', AUS: 'AUS', DE: 'DEU', FR: 'FRA', PR: 'PRI',
};

const COUNTRY_NAME: Record<string, string> = {
  USA: 'United States', CAN: 'Canada', MEX: 'Mexico', GBR: 'United Kingdom',
  AUS: 'Australia', DEU: 'Germany', FRA: 'France', PRI: 'Puerto Rico',
};

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

      // Order metadata from the stored request payload (best effort).
      let ship: any = null;
      let orderDate: string | null = null;
      let humanOrderNumber: string | null = null;
      let custEmail: string | null = null;
      let custName: string | null = null;
      try {
        const obj = row.request_payload_key ? await env.R2.get(row.request_payload_key as string) : null;
        if (obj) {
          const body = JSON.parse(await obj.text());
          ship = body?.shipmentAddress || null;
          orderDate = body?.shipmentOrderDate || null;
          humanOrderNumber = body?.channelOrderNumber || body?.clientReferenceCode || null;
          custEmail = body?.customer?.email || body?.billingAddress?.email || null;
          const fn = body?.customer?.firstName || '';
          const ln = body?.customer?.lastName || '';
          custName = `${fn} ${ln}`.trim() || null;
        }
      } catch { /* omit metadata rather than fail the push */ }
      const customAddress = ship?.addressLine1
        ? [ship.addressLine1, ship.city, ship.state, ship.postalCode, ship.country || 'US'].filter(Boolean).join(',')
        : null;

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

        // ── Group A enrichment (operational fields, no PII) ──
        payload.order_number = humanOrderNumber || row.external_order_id;
        if (orderDate) {
          payload.order_date = /^\d{4}-\d{2}-\d{2}$/.test(orderDate) ? `${orderDate}T00:00:00Z` : orderDate;
        }
        if (ship) {
          if (ship.city) payload.destination_city = ship.city;
          if (ship.state) payload.destination_state = ship.state;
          if (ship.postalCode) payload.destination_postal_code = ship.postalCode;
          // AfterShip requires ISO 3166 alpha-3 ("USA"); orders carry alpha-2.
          const a3 = COUNTRY_A3[String(ship.country || 'US').toUpperCase()];
          if (a3) payload.destination_country_region = a3;
          // Raw location string in the old WMS's format — feeds the UI's
          // "Shipping address" row.
          const countryName = a3 ? COUNTRY_NAME[a3] : null;
          const rawParts = [ship.city, ship.state, ship.postalCode, a3, countryName].filter(Boolean);
          if (rawParts.length >= 3) payload.destination_raw_location = rawParts.join(', ');
        }
        // Origin: KSP ships domestically — matches the old WMS's constant.
        payload.origin_country_region = 'USA';
        payload.origin_raw_location = 'United States';
        // Customer (matches old WMS: recorded on the tracking, but NOT
        // subscribed — AfterShip sends them no notifications).
        if (custEmail || custName) {
          payload.customers = [{ email: custEmail, name: custName }];
        }
        // Per-package details for THIS tracking number.
        const pieces = ((lo.shipmentInfo || []) as any[]).filter((i) => i?.trackingNumber === tn);
        const shipMethod = pieces[0]?.shippingOptionName || (lo.shipmentInfo || [])[0]?.shippingOptionName;
        if (shipMethod) {
          payload.shipping_method = shipMethod;
          // Also shown as "Carrier service type" in the AfterShip UI.
          payload.shipment_type = shipMethod;
        }
        const w = pieces[0]?.licensePlateWeight ?? pieces[0]?.licensePlateCalculatedWeight;
        const wuRaw = String(pieces[0]?.licensePlateWeightUnitName || '').toLowerCase();
        const wu = wuRaw.startsWith('pound') ? 'lb' : wuRaw.startsWith('kilo') ? 'kg' : null;
        if (w != null && wu) payload.shipment_weight = { unit: wu, value: Number(w) };
        // (tracking_ship_date intentionally NOT sent — AfterShip rejects it and
        // the courier populates ship dates from scans anyway.)

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
