import { Env } from '../index';

/**
 * Endpoint enforcement (tenant_endpoints, migration 0002 — enforced Sep 2026).
 *
 * The portal's Clients form has always written per-tenant endpoint selections;
 * the router now enforces them: a disabled or missing row => 403. Types here
 * MUST mirror the portal's ENDPOINT_TYPES list (portal/src/pages/Tenants.tsx).
 *
 * Fail-open: if the D1 lookup itself errors, allow the request — an infra
 * hiccup must never take down live client traffic.
 */

export function resolveEndpointType(method: string, path: string): string | null {
  if (path.startsWith('/v1/orders')) {
    if (path.endsWith('/tracking')) return 'tracking';
    if (path === '/v1/orders/bulk') return 'bulk_orders';
    if (path === '/v1/orders' || path === '/v1/orders/') {
      return method === 'POST' ? 'create_order' : 'list_orders';
    }
    return 'get_order'; // /v1/orders/:id
  }
  if (path.startsWith('/v1/inventory')) {
    if (path.startsWith('/v1/inventory/availability')) return 'inventory_availability';
    if (path === '/v1/inventory/query') return 'inventory';
    return 'list_inventory'; // GET /v1/inventory
  }
  if (path.startsWith('/v1/purchase-orders')) {
    if (path.endsWith('/receipts')) return 'po_receipts';
    if (path === '/v1/purchase-orders' || path === '/v1/purchase-orders/') {
      return method === 'POST' ? 'create_po' : 'list_po';
    }
    return 'get_po'; // /v1/purchase-orders/:id
  }
  if (path.startsWith('/v1/products')) {
    return method === 'POST' ? 'create_product' : 'list_products';
  }
  return null; // unknown path — falls through to the router's 404
}

export async function isEndpointEnabled(
  env: Env,
  tenantId: string,
  endpointType: string
): Promise<boolean> {
  try {
    const row = (await env.DB.prepare(
      `SELECT enabled FROM tenant_endpoints WHERE tenant_id = ? AND endpoint_type = ?`
    ).bind(tenantId, endpointType).first()) as { enabled: number } | null;
    return !!row && row.enabled === 1;
  } catch (err) {
    console.error('[endpoints] check failed (fail-open):', err instanceof Error ? err.message : err);
    return true;
  }
}
