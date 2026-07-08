import { Env } from '../index';
import { TenantContext } from '../auth';
import { handleOrders } from './orders';

/**
 * Zoho CRM connector — inbound webhook (Fred / Rescue ID).
 *
 * Zoho posts a Sales Order in its native shape. The router authenticates the
 * request (X-API-Key -> tenant) before calling this. We:
 *   1. capture the raw payload in R2 (always — so we can inspect/finalize mapping),
 *   2. translate it to the gateway's order schema,
 *   3. delegate to the EXISTING /v1/orders path (handleOrders) for the Logiwa create,
 *   4. record everything in zoho_sync for idempotency + portal visibility.
 *
 * ADDITIVE: new file. Reuses handleOrders without modifying it.
 */

interface ZohoAccount {
  tenant_id: string;
  orders_module: string;
  field_map: string | null;
  inbound_enabled: number;
}

// Read a dotted path ("id", "Contact_Name.first_name") from an object.
function getPath(obj: any, path: string): any {
  if (!path) return undefined;
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

// First non-empty value found at any of the candidate paths.
function firstDefined(obj: any, keys: (string | undefined)[]): any {
  for (const k of keys) {
    if (!k) continue;
    const v = getPath(obj, k);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// Unwrap the order record from common Zoho envelope shapes.
function unwrap(payload: any): any {
  if (Array.isArray(payload)) return payload[0];
  if (payload?.data && Array.isArray(payload.data)) return payload.data[0];
  return payload?.record || payload;
}

/**
 * Map a Zoho payload -> gateway order body (Logiwa-native passthrough shape).
 * Uses field_map (JSON) if configured, else a best-effort default for common
 * Zoho Sales_Order field names. Returns null if the essentials (order code +
 * at least one line item with a SKU) can't be found — the caller keeps the raw
 * payload so we can finalize the mapping from a real sample.
 */
export function mapZohoToOrder(payload: any, fieldMap: any): any | null {
  const rec = unwrap(payload);
  const map = fieldMap || {};

  const code = firstDefined(rec, [map.code, 'code', 'Subject', 'Sales_Order_Number', 'id']);

  const rawLines =
    firstDefined(rec, [map.lineItems, 'Product_Details', 'Ordered_Items', 'line_items', 'items']) || [];
  const lines = Array.isArray(rawLines) ? rawLines : [];

  const shipmentOrderLineList = lines
    .map((li: any) => ({
      sku: firstDefined(li, [map.lineSku, 'sku', 'SKU', 'Product_Code', 'product.Product_Code', 'product_code']),
      packQuantity: Number(firstDefined(li, [map.lineQty, 'packQuantity', 'quantity', 'Quantity']) ?? 1),
      packType: firstDefined(li, [map.linePackType, 'packType']) || 'Unit',
    }))
    .filter((li: any) => li.sku);

  if (!code || shipmentOrderLineList.length === 0) return null;

  const order: any = { code: String(code), shipmentOrderLineList };

  const addrCandidates: Record<string, (string | undefined)[]> = {
    country: [map.country, 'Shipping_Country', 'shipping_country', 'country'],
    state: [map.state, 'Shipping_State', 'shipping_state', 'state'],
    addressLine1: [map.address1, 'Shipping_Street', 'shipping_street', 'address1'],
    addressLine2: [map.address2, 'Shipping_Street_2', 'address2'],
    city: [map.city, 'Shipping_City', 'shipping_city', 'city'],
    postalCode: [map.zip, 'Shipping_Code', 'shipping_code', 'zip', 'postalCode'],
    phoneNumber: [map.phone, 'Phone', 'phone'],
  };
  const shipmentAddress: any = {};
  for (const [field, paths] of Object.entries(addrCandidates)) {
    const v = firstDefined(rec, paths);
    if (v !== undefined) shipmentAddress[field] = v;
  }
  if (!shipmentAddress.country) shipmentAddress.country = 'US';
  if (Object.keys(shipmentAddress).length > 1) order.shipmentAddress = shipmentAddress;

  const customer: any = {};
  const firstName = firstDefined(rec, [map.firstName, 'Contact_Name.first_name', 'firstName']);
  const lastName = firstDefined(rec, [map.lastName, 'Contact_Name.last_name', 'lastName']);
  const email = firstDefined(rec, [map.email, 'Email', 'email']);
  if (firstName) customer.firstName = firstName;
  if (lastName) customer.lastName = lastName;
  if (email) customer.email = email;
  if (Object.keys(customer).length) order.customer = customer;

  return order;
}

export async function handleZohoWebhook(
  request: Request,
  env: Env,
  tenant: TenantContext
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }, { status: 405 });
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } }, { status: 400 });
  }

  const account = (await env.DB.prepare(
    'SELECT tenant_id, orders_module, field_map, inbound_enabled FROM zoho_accounts WHERE tenant_id = ?'
  ).bind(tenant.tenantId).first()) as ZohoAccount | null;

  if (account && account.inbound_enabled === 0) {
    return Response.json({ received: true, ignored: true, reason: 'inbound disabled' });
  }

  // Always capture the raw payload for inspection / mapping refinement.
  const eventId = crypto.randomUUID();
  const r2Key = `zoho/${tenant.tenantId}/${eventId}/webhook.json`;
  await env.R2.put(r2Key, JSON.stringify({ receivedAt: new Date().toISOString(), payload }));

  const rec = unwrap(payload);
  const zohoRecordId = String(firstDefined(rec, ['id', 'ids', 'record_id', 'entity_id']) ?? eventId);

  let fieldMap: any = null;
  try {
    fieldMap = account?.field_map ? JSON.parse(account.field_map) : null;
  } catch {
    fieldMap = null;
  }

  // Idempotency — already ingested this Zoho record?
  const existing = (await env.DB.prepare(
    'SELECT id, inbound_status, gateway_order_id FROM zoho_sync WHERE tenant_id = ? AND zoho_record_id = ?'
  ).bind(tenant.tenantId, zohoRecordId).first()) as any;

  if (existing && existing.inbound_status === 'sent') {
    return Response.json({ received: true, duplicate: true, zohoRecordId, orderId: existing.gateway_order_id });
  }

  const order = mapZohoToOrder(payload, fieldMap);
  const syncId = existing?.id || crypto.randomUUID();

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO zoho_sync (id, tenant_id, zoho_record_id, order_code, source, inbound_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'webhook', 'received', datetime('now'), datetime('now'))`
    ).bind(syncId, tenant.tenantId, zohoRecordId, order?.code ?? null).run();
  }

  if (!order) {
    await env.DB.prepare(
      `UPDATE zoho_sync SET inbound_status='error', last_error=?, updated_at=datetime('now') WHERE id=?`
    ).bind(`Could not map payload to an order (missing code or line items). Raw: ${r2Key}`, syncId).run();
    return Response.json({
      received: true,
      mapped: false,
      zohoRecordId,
      message: 'Payload captured but not yet mappable to an order. KSP will finalize field mapping.',
    });
  }

  // Reuse the existing /v1/orders path — same validation, Logiwa create, logging.
  const orderReq = new Request('https://internal/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  });
  const orderRes = await handleOrders(orderReq, env, tenant, '/v1/orders');
  const result = (await orderRes.json().catch(() => ({}))) as any;

  const status = result.status || (orderRes.ok ? 'sent' : 'error');
  await env.DB.prepare(
    `UPDATE zoho_sync SET order_code=?, gateway_order_id=?, inbound_status=?, last_error=?, updated_at=datetime('now') WHERE id=?`
  )
    .bind(
      order.code,
      result.orderId ?? null,
      status,
      status === 'error' ? (result.message ?? 'order create failed') : null,
      syncId
    )
    .run();

  return Response.json(
    {
      received: true,
      mapped: true,
      zohoRecordId,
      orderId: result.orderId ?? null,
      code: order.code,
      status,
      message: result.message ?? 'Order forwarded to Logiwa',
    },
    { status: orderRes.status === 201 ? 200 : orderRes.status }
  );
}
