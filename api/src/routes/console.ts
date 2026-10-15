import { Env } from '../index';
import { TenantContext } from '../auth';
import { handleOrders } from './orders';
import { handleTracking } from './tracking';
import { handleInventory } from './inventory';
import { handlePurchaseOrders } from './purchase-orders';
import { handleProducts } from './products';
import { resolveEndpointType, isEndpointEnabled } from '../lib/endpoints';

/**
 * Internal act-as-client endpoint for the portal's API Console.
 *
 * POST /admin/console — authenticated by a shared secret in KV `console:secret`
 * (same KV namespace is bound to the portal, which reads it server-side; the
 * secret never reaches a browser). The call executes through the REAL route
 * handlers with the tenant's context — mappings, pack-type validation, and
 * endpoint enforcement all apply — so the captured response is exactly what
 * the client's own key would produce. No API key is involved or needed.
 *
 * Writes made here are real (an order created lands in Logiwa + the portal),
 * which is the point during onboarding; the portal shows a confirm step and
 * every call is audited in console_calls with the operator's Access email.
 */
export async function handleConsole(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405 });
  }

  const secret = await env.KV.get('console:secret');
  const given = request.headers.get('X-Console-Secret');
  if (!secret || !given || given !== secret) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let req: {
    tenantId?: string; method?: string; path?: string;
    query?: string; body?: unknown; operatorEmail?: string;
    environment?: string; // optional override: 'sandbox' | 'production' (default: tenant's env)
  };
  try {
    req = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.path || '');
  if (!req.tenantId || !path.startsWith('/v1/')) {
    return Response.json({ error: 'tenantId and a /v1/... path are required' }, { status: 400 });
  }
  if (!['GET', 'POST'].includes(method)) {
    return Response.json({ error: 'GET and POST only' }, { status: 400 });
  }

  const tenantRow = (await env.DB.prepare(
    `SELECT id, name, active, logiwa_environment FROM tenants WHERE id = ?`
  ).bind(req.tenantId).first()) as any;
  if (!tenantRow || tenantRow.active !== 1) {
    return Response.json({ error: 'tenant not found or inactive' }, { status: 404 });
  }

  // Operator-chosen environment (sandbox/production), defaulting to the
  // tenant's current one — a client can have keys in both and query either.
  const chosenEnv = req.environment === 'production' || req.environment === 'sandbox'
    ? req.environment
    : (tenantRow.logiwa_environment === 'production' ? 'production' : 'sandbox');

  const tenant: TenantContext = {
    tenantId: tenantRow.id,
    tenantName: tenantRow.name,
    rateLimit: 60,
    active: true,
    environment: chosenEnv,
  };

  // Honor endpoint enforcement — a disabled endpoint 403s here exactly as it
  // would for the client's key (useful when demonstrating that very 403).
  const started = Date.now();
  let response: Response;
  const epType = resolveEndpointType(method, path);
  if (epType && !(await isEndpointEnabled(env, tenant.tenantId, epType))) {
    response = Response.json({
      error: { message: `Endpoint not enabled for this account: ${method} ${path} (${epType}). Contact KSP to enable it.`, code: 'ENDPOINT_DISABLED' },
    }, { status: 403 });
  } else {
    const qs = req.query ? (String(req.query).startsWith('?') ? String(req.query) : `?${req.query}`) : '';
    const internal = new Request(`https://internal${path}${qs}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' && req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });

    try {
      if (path.startsWith('/v1/orders') && path.includes('/tracking')) {
        response = await handleTracking(internal, env, tenant, path);
      } else if (path.startsWith('/v1/orders')) {
        response = await handleOrders(internal, env, tenant, path);
      } else if (path.startsWith('/v1/inventory')) {
        response = await handleInventory(internal, env, tenant, path);
      } else if (path.startsWith('/v1/purchase-orders')) {
        response = await handlePurchaseOrders(internal, env, tenant, path);
      } else if (path.startsWith('/v1/products')) {
        response = await handleProducts(internal, env, tenant, path);
      } else {
        response = Response.json({ error: 'unknown /v1 path' }, { status: 404 });
      }
    } catch (err: any) {
      // Route handlers throw ApiError for 4xx — surface it like the router does.
      if (err && typeof err.toResponse === 'function') response = err.toResponse();
      else response = Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  const durationMs = Date.now() - started;
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* non-JSON stays text */ }

  try {
    await env.DB.prepare(
      `INSERT INTO console_calls (id, operator_email, tenant_id, method, path, status_code, environment)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), req.operatorEmail ?? null, tenant.tenantId, method, path, response.status, tenant.environment).run();
  } catch (e) {
    console.log('[console] audit write failed:', e instanceof Error ? e.message : e);
  }

  return Response.json({
    status: response.status,
    body,
    environment: tenant.environment,
    tenantName: tenant.tenantName,
    durationMs,
  });
}
