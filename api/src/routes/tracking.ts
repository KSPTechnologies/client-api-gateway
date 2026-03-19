import { Env } from '../index';
import { TenantContext } from '../auth';

export async function handleTracking(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  // GET /v1/orders/:id/tracking
  const match = path.match(/^\/v1\/orders\/([^/]+)\/tracking$/);
  if (!match) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const orderId = match[1];
  // TODO: Phase 3 — lookup tracking from Logiwa via D1 cache or live call
  return Response.json({
    orderId,
    tenantId: tenant.tenantId,
    tracking: null,
    status: 'stub',
  });
}
