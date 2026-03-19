import { Env } from '../index';
import { TenantContext } from '../auth';

export async function handleInventory(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  // POST /v1/inventory/query — query inventory by SKU(s)
  if (request.method === 'POST' && path === '/v1/inventory/query') {
    // TODO: Phase 3 — query Logiwa or inventory_cache in D1
    return Response.json({
      tenantId: tenant.tenantId,
      items: [],
      status: 'stub',
    });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
