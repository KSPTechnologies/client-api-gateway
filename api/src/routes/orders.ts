import { Env } from '../index';
import { TenantContext } from '../auth';

export async function handleOrders(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  const method = request.method;

  // POST /v1/orders — create order
  if (method === 'POST' && path === '/v1/orders') {
    // TODO: Phase 3 — validate payload, call Logiwa, store in D1
    return Response.json({
      message: 'Order received',
      tenantId: tenant.tenantId,
    }, { status: 201 });
  }

  // GET /v1/orders/:id — get order status
  const orderMatch = path.match(/^\/v1\/orders\/([^/]+)$/);
  if (method === 'GET' && orderMatch) {
    const orderId = orderMatch[1];
    // TODO: Phase 3 — lookup in D1, optionally refresh from Logiwa
    return Response.json({
      orderId,
      tenantId: tenant.tenantId,
      status: 'stub',
    });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
