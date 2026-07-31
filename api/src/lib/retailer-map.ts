import { Env } from '../index';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Per-tenant retailer mapping (retailer_mappings table).
 *
 * Clients send their own customer/retailer number in
 * retailerDetails.retailerIdentifier (e.g. "899321"). Logiwa requires a GUID
 * there (422 otherwise — verified live), so:
 *   - mapped value      -> swap in the Logiwa retailer GUID (packing-slip
 *                          logic keys off this); original number preserved in
 *                          retailerCustomerAccountNumber if that's empty.
 *   - unmapped value    -> move the number to retailerCustomerAccountNumber
 *                          and drop the identifier; order proceeds with the
 *                          standard slip. Nothing lost, nothing rejected.
 *   - already a GUID    -> left untouched.
 *   - no retailerDetails -> no-op (the overwhelmingly common case).
 */
export async function applyRetailerMapping(
  env: Env,
  tenantId: string,
  order: Record<string, unknown>
): Promise<void> {
  const rd = order?.retailerDetails as Record<string, unknown> | undefined;
  const raw = rd?.retailerIdentifier;
  if (!rd || raw === undefined || raw === null || raw === '') return;

  const value = String(raw).trim();
  if (GUID_RE.test(value)) return; // real GUID — pass through

  try {
    const row = (await env.DB.prepare(
      `SELECT retailer_uuid, retailer_name FROM retailer_mappings
       WHERE tenant_id = ? AND enabled = 1 AND match_value = ?`
    ).bind(tenantId, value).first()) as any;

    if (row && row.retailer_uuid) {
      rd.retailerIdentifier = row.retailer_uuid;
      if (!rd.retailerCustomerAccountNumber) rd.retailerCustomerAccountNumber = value;
      console.log(`[retailermap] tenant=${tenantId} '${value}' -> ${row.retailer_name || row.retailer_uuid}`);
    } else {
      // Unmapped: keep the number where Logiwa accepts strings; drop the
      // GUID-typed field so the order isn't rejected.
      delete rd.retailerIdentifier;
      if (!rd.retailerCustomerAccountNumber) rd.retailerCustomerAccountNumber = value;
      console.log(`[retailermap] tenant=${tenantId} '${value}' unmapped — moved to retailerCustomerAccountNumber`);
    }
  } catch (err) {
    // Never fail an order over slip routing; worst case Logiwa rejects the
    // raw value and the error is visible in the portal.
    console.log('[retailermap] failed:', err instanceof Error ? err.message : String(err));
  }
}
