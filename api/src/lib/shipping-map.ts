import { Env } from '../index';

/**
 * Per-tenant shipping-option rewrite (shipping_option_mappings table).
 * If the order's shippingOptionDetails.carrierSetupName matches a mapping for
 * this tenant, the whole shippingOptionDetails object is replaced with the
 * configured production version. No rows for a tenant = no-op, so existing
 * clients are untouched.
 */
export async function applyShippingOptionMapping(
  env: Env,
  tenantId: string,
  order: Record<string, unknown>
): Promise<void> {
  const details = order?.shippingOptionDetails as Record<string, unknown> | undefined;
  const setupName = details?.carrierSetupName;
  if (!setupName || typeof setupName !== 'string') return;

  try {
    const row = (await env.DB.prepare(
      `SELECT replacement FROM shipping_option_mappings
       WHERE tenant_id = ? AND enabled = 1 AND lower(match_setup_name) = lower(?)`
    ).bind(tenantId, setupName).first()) as any;
    if (!row || !row.replacement) return;

    const replacement = JSON.parse(row.replacement);
    order.shippingOptionDetails = replacement;
    console.log(`[shipmap] tenant=${tenantId} '${setupName}' -> '${replacement?.carrierSetupName ?? '?'}'`);
  } catch (err) {
    // Mapping is best-effort — never fail an order over it.
    console.log('[shipmap] failed:', err instanceof Error ? err.message : String(err));
  }
}
