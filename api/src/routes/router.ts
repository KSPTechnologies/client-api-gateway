import { Env } from '../index';
import { authenticateRequest, TenantContext } from '../auth';
import { handleOrders } from './orders';
import { handleTracking } from './tracking';
import { handleInventory } from './inventory';
import { handlePurchaseOrders } from './purchase-orders';
import { handleProducts } from './products';
import { handleWebhooks } from './webhooks';
import { handleZohoWebhook } from './zoho';
import { logRequest } from '../lib/logger';
import { checkRateLimit } from '../lib/rate-limit';
import { ApiError, unauthorized, notFound, rateLimited, internal } from '../lib/errors';

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // Health check — no auth required
  if (path === '/v1/health') {
    return withCors(Response.json({ status: 'ok', timestamp: new Date().toISOString() }));
  }

  // Zoho connector webhook — authenticated (X-API-Key), translates Zoho -> order.
  // Must precede the generic Logiwa webhook branch below.
  if (path === '/v1/webhooks/zoho' || path === '/v1/webhooks/zoho/') {
    const zohoTenant = await authenticateRequest(request, env);
    if (!zohoTenant) {
      return withCors(unauthorized().toResponse());
    }
    const zohoResponse = await handleZohoWebhook(request, env, zohoTenant);
    ctx.waitUntil(logRequest(env, zohoTenant.tenantId, request, zohoResponse));
    return withCors(zohoResponse);
  }

  // Webhooks from Logiwa — no API key auth required
  if (path.startsWith('/v1/webhooks/')) {
    return withCors(await handleWebhooks(request, env, path));
  }

  // Authenticate
  const tenant = await authenticateRequest(request, env);
  if (!tenant) {
    return withCors(unauthorized().toResponse());
  }

  // Rate limit
  const { allowed, remaining, resetSeconds } = await checkRateLimit(env, tenant.tenantId, tenant.rateLimit);
  if (!allowed) {
    return withCors(rateLimited().toResponse(), {
      'X-RateLimit-Limit': tenant.rateLimit.toString(),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': resetSeconds.toString(),
      'Retry-After': resetSeconds.toString(),
    });
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
    } else if (path.startsWith('/v1/purchase-orders')) {
      response = await handlePurchaseOrders(request, env, tenant, path);
    } else if (path.startsWith('/v1/products')) {
      response = await handleProducts(request, env, tenant, path);
    } else {
      response = notFound().toResponse();
    }
  } catch (err) {
    if (err instanceof ApiError) {
      response = err.toResponse();
      ctx.waitUntil(logRequest(env, tenant.tenantId, request, response, err.message));
      return withCors(response, rateLimitHeaders(tenant.rateLimit, remaining, resetSeconds));
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    response = internal(message).toResponse();
    ctx.waitUntil(logRequest(env, tenant.tenantId, request, response, message));
    return withCors(response, rateLimitHeaders(tenant.rateLimit, remaining, resetSeconds));
  }

  // Log successful request
  ctx.waitUntil(logRequest(env, tenant.tenantId, request, response));

  return withCors(response, rateLimitHeaders(tenant.rateLimit, remaining, resetSeconds));
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function rateLimitHeaders(limit: number, remaining: number, resetSeconds: number): Record<string, string> {
  return {
    'X-RateLimit-Limit': limit.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': resetSeconds.toString(),
  };
}

function withCors(response: Response, extra?: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      headers.set(k, v);
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
