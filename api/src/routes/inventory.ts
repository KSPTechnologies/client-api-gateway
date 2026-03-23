import { Env } from '../index';
import { TenantContext } from '../auth';
import { inventoryQuerySchema } from '../lib/validate';
import { badRequest, methodNotAllowed } from '../lib/errors';
import { getLogiwaCredentials, getTenantLogiwaConfig, queryInventory, LogiwaCredentials } from '../lib/logiwa';
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

export async function handleInventory(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  // GET /v1/inventory — list all inventory (passthrough to Logiwa with tenant scoping)
  if (request.method === 'GET' && path === '/v1/inventory') {
    const logiwaConfig = await getTenantLogiwaConfig(env, tenant.tenantId);
    const creds = getLogiwaCredentials(env, logiwaConfig.environment, logiwaConfig.clientIdentifier);

    if (!creds) {
      throw badRequest('Logiwa credentials not configured for this environment');
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '0');
    const size = parseInt(url.searchParams.get('size') || '200');

    // Build filters — always inject client identifier for tenant scoping
    const filters: Record<string, string> = {};
    if (creds.clientIdentifier) {
      filters['ClientIdentifier.eq'] = creds.clientIdentifier;
    }
    // Pass through any LQL filters from the client's query string
    for (const [key, value] of url.searchParams) {
      if (key !== 'page' && key !== 'size') {
        filters[key] = value;
      }
    }

    try {
      const filterParams = new URLSearchParams(filters);
      const result = await logiwaFetchDirect(creds, 'GET', `/v3.1/Inventory/list/i/${page}/s/${size}?${filterParams.toString()}`);
      return Response.json(result);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Logiwa list inventory failed:', errMsg);

      await env.DB.prepare(
        `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
         VALUES (?, '/v1/inventory', 'GET', ?, 502, 0, 0, datetime('now'))`
      ).bind(tenant.tenantId, errMsg).run();

      return Response.json({ error: errMsg }, { status: 502 });
    }
  }

  if (request.method === 'POST' && path === '/v1/inventory/query') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw badRequest('Invalid JSON body');
    }

    const parsed = inventoryQuerySchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw badRequest(`Validation failed: ${issues.join('; ')}`);
    }

    const { skus } = parsed.data;

    // Query inventory cache in D1
    const placeholders = skus.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT sku, quantity, last_synced_at
       FROM inventory_cache
       WHERE tenant_id = ? AND sku IN (${placeholders})`
    )
      .bind(tenant.tenantId, ...skus)
      .all();

    const found = new Map(results.map((r: any) => [r.sku as string, r]));
    const missedSkus = skus.filter((sku) => !found.has(sku));

    // For cache misses, query Logiwa live and backfill cache
    if (missedSkus.length > 0) {
      const logiwaConfig = await getTenantLogiwaConfig(env, tenant.tenantId);
      const creds = getLogiwaCredentials(env, logiwaConfig.environment, logiwaConfig.clientIdentifier);
      if (creds) {
        try {
          const liveItems = await queryInventory(creds, missedSkus);
          for (const item of liveItems) {
            found.set(item.productSku, {
              sku: item.productSku,
              quantity: item.availableQuantity,
              last_synced_at: new Date().toISOString(),
            });

            await env.DB.prepare(
              `INSERT INTO inventory_cache (tenant_id, sku, quantity, last_synced_at)
               VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT (tenant_id, sku) DO UPDATE SET quantity = ?, last_synced_at = datetime('now')`
            )
              .bind(tenant.tenantId, item.productSku, item.availableQuantity, item.availableQuantity)
              .run();
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('Logiwa inventory query failed:', errMsg);
          await env.DB.prepare(
            `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
             VALUES (?, '/v1/inventory/query', 'POST', ?, 502, 0, 0, datetime('now'))`
          ).bind(tenant.tenantId, errMsg).run();
        }
      }
    }

    const items = skus.map((sku) => {
      const cached = found.get(sku);
      return cached
        ? { sku, quantity: cached.quantity, lastSyncedAt: cached.last_synced_at }
        : { sku, quantity: null, lastSyncedAt: null };
    });

    return Response.json({ items });
  }

  throw methodNotAllowed();
}
