import { Env } from '../index';
import { authenticateRequest, TenantContext } from '../auth';
import { handleOrders } from './orders';
import { handleTracking } from './tracking';
import { handleInventory } from './inventory';
import { logRequest } from '../lib/logger';

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Health check — no auth required
  if (path === '/v1/health') {
    return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
  }

  // Authenticate
  const tenant = await authenticateRequest(request, env);
  if (!tenant) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Route
  let response: Response;
  try {
    if (path.startsWith('/v1/orders') && path.includes('/tracking')) {
      response = await handleTracking(request, env, tenant, path);
    } else if (path.startsWith('/v1/orders')) {
      response = await handleOrders(request, env, tenant, path);
    } else if (path.startsWith('/v1/inventory')) {
      response = await handleInventory(request, env, tenant, path);
    } else {
      response = Response.json({ error: 'Not found' }, { status: 404 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    response = Response.json({ error: message }, { status: 500 });

    // Log error to D1
    ctx.waitUntil(
      logRequest(env, tenant.tenantId, request, response, message)
    );
    return response;
  }

  // Log successful request
  ctx.waitUntil(logRequest(env, tenant.tenantId, request, response));

  return response;
}
