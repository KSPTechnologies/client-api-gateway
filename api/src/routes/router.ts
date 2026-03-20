import { Env } from '../index';
import { authenticateRequest, TenantContext } from '../auth';
import { handleOrders } from './orders';
import { handleTracking } from './tracking';
import { handleInventory } from './inventory';
import { handlePurchaseOrders } from './purchase-orders';
import { handleWebhooks } from './webhooks';
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
  const { allowed, remaining } = await checkRateLimit(env, tenant.tenantId, tenant.rateLimit);
  if (!allowed) {
    return withCors(rateLimited().toResponse(), {
      'X-RateLimit-Limit': tenant.rateLimit.toString(),
      'X-RateLimit-Remaining': '0',
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
    } else {
      response = notFound().toResponse();
    }
  } catch (err) {
    if (err instanceof ApiError) {
      response = err.toResponse();
      ctx.waitUntil(logRequest(env, tenant.tenantId, request, response, err.message));
      return withCors(response, rateLimitHeaders(tenant.rateLimit, remaining));
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    response = internal(message).toResponse();
    ctx.waitUntil(logRequest(env, tenant.tenantId, request, response, message));
    return withCors(response, rateLimitHeaders(tenant.rateLimit, remaining));
  }

  // Log successful request
  ctx.waitUntil(logRequest(env, tenant.tenantId, request, response));

  return withCors(response, rateLimitHeaders(tenant.rateLimit, remaining));
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function rateLimitHeaders(limit: number, remaining: number): Record<string, string> {
  return {
    'X-RateLimit-Limit': limit.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
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
