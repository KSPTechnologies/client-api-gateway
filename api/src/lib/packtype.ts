import { Env } from '../index';
import { LogiwaCredentials, logiwaFetch } from './logiwa';

/**
 * Fill in missing packType on order lines with the product's default pack type
 * (uomPackTypeName), looked up from Logiwa and cached per tenant+SKU in D1.
 *
 * This makes the documented behavior — "packType: uses product default if
 * omitted" — actually true. It only touches lines that OMIT packType, which
 * today are guaranteed Logiwa 400s (ERR_wms_PRODUCTPACKTYPENOTEXISTS), so it
 * strictly expands the set of requests that succeed; lines that already carry
 * a packType are passed through untouched.
 *
 * Resolution failures are non-fatal: the line is left as-is and Logiwa returns
 * its normal error, same as before.
 */
export async function resolveMissingPackTypes(
  env: Env,
  creds: LogiwaCredentials,
  tenantId: string,
  order: Record<string, unknown>
): Promise<void> {
  // Works for both shipment orders and purchase orders.
  const lines = [
    ...(Array.isArray(order?.shipmentOrderLineList) ? (order.shipmentOrderLineList as unknown[]) : []),
    ...(Array.isArray(order?.purchaseOrderLineList) ? (order.purchaseOrderLineList as unknown[]) : []),
  ];
  if (lines.length === 0) return;

  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const li = line as Record<string, unknown>;
    if (li.packType || !li.sku) continue;
    const sku = String(li.sku);

    try {
      const cached = await env.DB.prepare(
        'SELECT pack_type FROM product_packtype_cache WHERE tenant_id = ? AND sku = ?'
      ).bind(tenantId, sku).first();
      if (cached && cached.pack_type) {
        li.packType = cached.pack_type as string;
        continue;
      }

      const params = new URLSearchParams({ 'Sku.eq': sku });
      if (creds.clientIdentifier) params.set('ClientIdentifier.eq', creds.clientIdentifier);
      const res = await logiwaFetch(creds, 'GET', `/v3.1/Product/list/i/0/s/1?${params.toString()}`);
      const packType = res?.data?.[0]?.uomPackTypeName;
      if (packType) {
        li.packType = packType;
        await env.DB.prepare(
          `INSERT INTO product_packtype_cache (tenant_id, sku, pack_type, synced_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(tenant_id, sku) DO UPDATE SET pack_type = excluded.pack_type, synced_at = datetime('now')`
        ).bind(tenantId, sku, packType).run();
      } else {
        console.log(`[packtype] no product/default found for sku=${sku} tenant=${tenantId}`);
      }
    } catch (err) {
      // Non-fatal — leave the line untouched; Logiwa will report as before.
      console.log(`[packtype] resolve failed for sku=${sku}:`, err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Pack-type CATALOG validation for product (SKU) creation. Clients must use
 * pack types that exist in Logiwa (e.g. Unit, Case, Master Case, Pack) — no
 * invented verbiage. Valid names come from /v3.1/Helper/packtypes, cached in
 * KV per environment for an hour.
 *
 * Matching is case-insensitive and the payload is normalized to Logiwa's
 * canonical casing ("unit" -> "Unit"); anything that doesn't match is
 * rejected by the caller with a 400 listing the allowed values.
 */
export async function getValidPackTypes(
  env: Env,
  creds: LogiwaCredentials,
  environment: string
): Promise<string[] | null> {
  const cacheKey = `packtypes:${environment}`;
  try {
    const cached = await env.KV.get(cacheKey, 'json') as string[] | null;
    if (cached && Array.isArray(cached) && cached.length > 0) return cached;
  } catch { /* fall through to live fetch */ }

  try {
    const result = await logiwaFetch(creds, 'GET', '/v3.1/Helper/packtypes');
    const names = ((result?.data ?? result) as Array<{ name?: string }> | undefined)
      ?.map((p) => p?.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (!names || names.length === 0) return null;
    try {
      await env.KV.put(cacheKey, JSON.stringify(names), { expirationTtl: 3600 });
    } catch { /* cache write is best-effort */ }
    return names;
  } catch (err) {
    console.log('[packtype] catalog fetch failed:', err instanceof Error ? err.message : String(err));
    return null; // caller treats null as "cannot validate" and passes through
  }
}

/**
 * Validate (and case-normalize) every pack-type-name field in a product
 * payload: the top-level uomPackTypeName plus any *packTypeName-ish string in
 * irregularPackTypeList / hierarchicalPackTypeList entries.
 * Returns the list of invalid values found (empty = all good).
 */
export function validateProductPackTypes(
  body: Record<string, unknown>,
  validNames: string[]
): string[] {
  const byLower = new Map(validNames.map((n) => [n.toLowerCase(), n]));
  const invalid: string[] = [];

  const checkAndNormalize = (obj: Record<string, unknown>, field: string) => {
    const val = obj[field];
    if (typeof val !== 'string' || val.trim() === '') return;
    const canonical = byLower.get(val.trim().toLowerCase());
    if (canonical) obj[field] = canonical;
    else if (!invalid.includes(val)) invalid.push(val);
  };

  checkAndNormalize(body, 'uomPackTypeName');

  for (const listField of ['irregularPackTypeList', 'hierarchicalPackTypeList']) {
    const list = body[listField];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      for (const key of Object.keys(e)) {
        if (/packtypename$/i.test(key)) checkAndNormalize(e, key);
      }
    }
  }

  return invalid;
}
