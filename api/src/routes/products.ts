import { Env } from '../index';
import { TenantContext } from '../auth';
import { badRequest, methodNotAllowed } from '../lib/errors';
import { getLogiwaCredentials, getTenantLogiwaConfig, LogiwaCredentials } from '../lib/logiwa';
import { ApiError } from '../lib/errors';

async function logiwaFetchDirect(
  creds: LogiwaCredentials,
  method: string,
  path: string,
  body?: unknown
): Promise<any> {
  const tokenRes = await fetch(`${creds.apiUrl}/v3.1/Authorize/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.username, password: creds.password }),
  });
  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    throw new ApiError(502, `Logiwa auth failed (${tokenRes.status}): ${errBody}`, 'LOGIWA_AUTH_FAILED');
  }
  const tokenData = await tokenRes.json() as { token: string };

  const res = await fetch(`${creds.apiUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenData.token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new ApiError(502, `Logiwa API error (${res.status}): ${errBody}`, 'LOGIWA_API_ERROR');
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function handleProducts(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  const method = request.method;
  const logiwaConfig = await getTenantLogiwaConfig(env, tenant.tenantId, tenant.environment);
  const creds = getLogiwaCredentials(env, logiwaConfig.environment, logiwaConfig.clientIdentifier);

  if (!creds) {
    throw badRequest('Logiwa credentials not configured for this environment');
  }

  // GET /v1/products — list products (passthrough to Logiwa with tenant scoping)
  if (method === 'GET' && path === '/v1/products') {
    const url = new URL(request.url);
    const page = Math.max(0, parseInt(url.searchParams.get('page') || '1') - 1);
    const size = parseInt(url.searchParams.get('size') || '100');

    // Build filters — always inject client identifier for tenant scoping
    const filters: Record<string, string> = {};
    if (creds.clientIdentifier) {
      filters['ClientIdentifier.eq'] = creds.clientIdentifier;
    }
    for (const [key, value] of url.searchParams) {
      if (key !== 'page' && key !== 'size') {
        filters[key] = value;
      }
    }

    try {
      const filterParams = new URLSearchParams(filters);
      const result = await logiwaFetchDirect(creds, 'GET', `/v3.1/Product/list/i/${page}/s/${size}?${filterParams.toString()}`);
      return Response.json(result);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Logiwa list products failed:', errMsg);

      await env.DB.prepare(
        `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
         VALUES (?, '/v1/products', 'GET', ?, 502, 0, 0, datetime('now'))`
      ).bind(tenant.tenantId, errMsg).run();

      return Response.json({ error: errMsg }, { status: 502 });
    }
  }

  // POST /v1/products — create product (passthrough to Logiwa native schema)
  if (method === 'POST' && path === '/v1/products') {
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      throw badRequest('Invalid JSON body');
    }

    if (!body.sku) {
      throw badRequest('Missing required field: sku');
    }

    // Store raw payload in R2
    const productId = crypto.randomUUID();
    const r2Key = `products/${tenant.tenantId}/${productId}/request.json`;
    await env.R2.put(r2Key, JSON.stringify(body));

    // Inject client identifier
    const payload = {
      ...body,
      clientIdentifier: creds.clientIdentifier,
    };

    try {
      const result = await logiwaFetchDirect(creds, 'POST', '/v3.1/Product/create', payload);
      const logiwaId = result.value || result.data || null;

      const responseKey = `products/${tenant.tenantId}/${productId}/response.json`;
      await env.R2.put(responseKey, JSON.stringify(result));

      return Response.json({
        productId,
        logiwaIdentifier: logiwaId,
        sku: body.sku,
        status: 'created',
        message: 'Product created in Logiwa',
      }, { status: 201 });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Logiwa create product failed:', errMsg);

      await env.DB.prepare(
        `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
         VALUES (?, '/v1/products', 'POST', ?, 502, 0, 0, datetime('now'))`
      ).bind(tenant.tenantId, errMsg).run();

      return Response.json({
        productId,
        sku: body.sku,
        status: 'error',
        message: errMsg,
      }, { status: 502 });
    }
  }

  throw methodNotAllowed();
}
