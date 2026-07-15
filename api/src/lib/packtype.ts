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
