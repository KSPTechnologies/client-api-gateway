import { Env } from '../index';
import { TenantContext } from '../auth';
import { badRequest, methodNotAllowed, notFound } from '../lib/errors';
import { getLogiwaCredentials, getTenantLogiwaConfig, getPurchaseOrder, getPurchaseOrderReceipts, LogiwaCredentials } from '../lib/logiwa';
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

export async function handlePurchaseOrders(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  const method = request.method;
  const logiwaConfig = await getTenantLogiwaConfig(env, tenant.tenantId);
  const creds = getLogiwaCredentials(env, logiwaConfig.environment, logiwaConfig.clientIdentifier);

  // POST /v1/purchase-orders — passthrough to Logiwa native schema
  if (method === 'POST' && path === '/v1/purchase-orders') {
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      throw badRequest('Invalid JSON body');
    }

    if (!body.code && !body.purchaseOrderLineList) {
      throw badRequest('Missing required fields: code, purchaseOrderLineList');
    }

    const poId = crypto.randomUUID();
    const poCode = (body.code as string) || poId;

    const r2Key = `purchase-orders/${tenant.tenantId}/${poId}/request.json`;
    await env.R2.put(r2Key, JSON.stringify(body));

    if (!creds) {
      throw badRequest('Logiwa credentials not configured for this environment');
    }

    // Inject gateway fields
    const payload = {
      ...body,
      clientIdentifier: creds.clientIdentifier,
      warehouseIdentifier: creds.warehouseIdentifier,
      purchaseOrderDate: body.purchaseOrderDate || new Date().toISOString().split('T')[0],
    };

    try {
      const result = await logiwaFetchDirect(creds, 'POST', '/v3.1/PurchaseOrder/create', payload);
      const logiwaId = result.value || result.data || null;

      const responseKey = `purchase-orders/${tenant.tenantId}/${poId}/response.json`;
      await env.R2.put(responseKey, JSON.stringify(result));

      return Response.json({
        purchaseOrderId: poId,
        logiwaIdentifier: logiwaId,
        code: poCode,
        status: 'sent',
        message: 'Purchase order created in Logiwa',
      }, { status: 201 });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to create purchase order';
      console.error('Logiwa create PO failed:', errMsg);

      await env.DB.prepare(
        `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
         VALUES (?, '/v1/purchase-orders', 'POST', ?, 502, 0, 0, datetime('now'))`
      ).bind(tenant.tenantId, errMsg).run();

      return Response.json({
        purchaseOrderId: poId,
        code: poCode,
        status: 'error',
        message: errMsg,
      }, { status: 502 });
    }
  }

  // GET /v1/purchase-orders/:id — get PO details
  const poMatch = path.match(/^\/v1\/purchase-orders\/([^/]+)$/);
  if (method === 'GET' && poMatch) {
    const poIdentifier = poMatch[1];

    if (!creds) {
      throw badRequest('Logiwa credentials not configured for this environment');
    }

    try {
      const po = await getPurchaseOrder(creds, poIdentifier);
      if (!po) throw notFound(`Purchase order ${poIdentifier} not found`);
      return Response.json(po);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_FOUND') throw err;
      throw notFound(`Purchase order ${poIdentifier} not found`);
    }
  }

  // GET /v1/purchase-orders/:id/receipts — get PO receiving history
  const receiptsMatch = path.match(/^\/v1\/purchase-orders\/([^/]+)\/receipts$/);
  if (method === 'GET' && receiptsMatch) {
    const poCode = receiptsMatch[1];

    if (!creds) {
      throw badRequest('Logiwa credentials not configured for this environment');
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '0');
    const size = parseInt(url.searchParams.get('size') || '50');

    const filters: Record<string, string> = { 'Code.eq': poCode };
    if (creds.clientIdentifier) {
      filters['ClientIdentifier.eq'] = creds.clientIdentifier;
    }

    const receipts = await getPurchaseOrderReceipts(creds, page, size, filters);

    return Response.json({
      purchaseOrderCode: poCode,
      receipts,
      page,
      size,
    });
  }

  throw methodNotAllowed();
}
