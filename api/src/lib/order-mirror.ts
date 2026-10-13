import { Env } from '../index';
import { getLogiwaCredentials, getTenantLogiwaConfig, logiwaFetch } from './logiwa';

/**
 * Logiwa order mirror (logiwa_order_mirrors, migration 0014).
 *
 * Some clients' orders are created directly in the Logiwa UI and never pass
 * through the gateway — but they still want to poll the gateway's tracking
 * endpoint. For each enabled tenant, list their Logiwa client's recently
 * created orders and insert any the gateway doesn't know yet into the orders
 * table (status 'sent', environment stamped, no R2 payload — the portal shows
 * these with a 'logiwa' source badge). From there the EXISTING tracking-sync,
 * recent-shipments sweep, and tracking endpoint handle them unchanged.
 *
 * ADDITIVE: new file, new table; runs only for tenants with a mirror row.
 * Idempotent: an order already present (by logiwa id or code) is skipped, so
 * overlap with any other channel can never duplicate.
 */

interface MirrorRow {
  tenant_id: string;
  lookback_days: number;
}

export async function syncOrderMirror(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT m.tenant_id, m.lookback_days FROM logiwa_order_mirrors m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.enabled = 1 AND t.active = 1`
  ).all();
  if (!results || results.length === 0) return;

  const errs: string[] = [];
  for (const row of results as unknown as MirrorRow[]) {
    try {
      await mirrorTenant(env, row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mirror] tenant ${row.tenant_id} failed:`, msg);
      errs.push(`${row.tenant_id}: ${msg}`);
    }
  }
  if (errs.length) throw new Error(errs.join(' | ')); // surfaces in the heartbeat
}

async function mirrorTenant(env: Env, row: MirrorRow): Promise<void> {
  const cfg = await getTenantLogiwaConfig(env, row.tenant_id);
  const creds = getLogiwaCredentials(env, cfg.environment, cfg.clientIdentifier);
  if (!creds || !cfg.clientIdentifier) {
    console.log(`[mirror] tenant ${row.tenant_id}: no Logiwa client mapping — skipped`);
    return;
  }

  const d = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86_400_000).toISOString().split('T')[0];
  const lookback = Math.min(Math.max(row.lookback_days || 3, 1), 30);
  const range = `${d(-lookback)},${d(1)}`;

  let imported = 0;
  for (let page = 0; page < 3; page++) {
    const res = await logiwaFetch(
      creds,
      'GET',
      `/v3.1/ShipmentOrder/list/i/${page}/s/200?ClientIdentifier.eq=${cfg.clientIdentifier}&CreatedDateTime.bt=${range}`
    );
    const rows: any[] = res?.data || [];

    for (const o of rows) {
      const logiwaId = o?.identifier ? String(o.identifier) : null;
      if (!logiwaId) continue;
      const code = o?.code ? String(o.code) : logiwaId;
      const status = String(o?.shipmentOrderStatusName || '');
      if (status.toLowerCase() === 'cancelled') continue; // never track dead orders

      const existing = await env.DB.prepare(
        `SELECT id FROM orders
         WHERE tenant_id = ? AND (lower(logiwa_order_id) = lower(?) OR external_order_id = ?)
         LIMIT 1`
      ).bind(row.tenant_id, logiwaId, code).first();
      if (existing) continue;

      await env.DB.prepare(
        `INSERT INTO orders (id, tenant_id, external_order_id, logiwa_order_id, status, environment, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'sent', ?, datetime('now'), datetime('now'))`
      ).bind(crypto.randomUUID(), row.tenant_id, code, logiwaId, cfg.environment).run();
      imported++;
    }
    if (rows.length < 200) break;
  }

  await env.DB.prepare(
    `UPDATE logiwa_order_mirrors SET last_run_at = datetime('now'), last_imported = ? WHERE tenant_id = ?`
  ).bind(imported, row.tenant_id).run();
  if (imported > 0) console.log(`[mirror] tenant ${row.tenant_id}: imported ${imported} orders`);
}
