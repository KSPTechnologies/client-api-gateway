import { Env } from '../index';
import { TenantContext } from '../auth';
import { badRequest, methodNotAllowed, notFound } from '../lib/errors';
import { getLogiwaCredentials, getTenantLogiwaConfig, LogiwaCredentials } from '../lib/logiwa';
import { ApiError } from '../lib/errors';

async function logiwaFetchDirect(
  creds: LogiwaCredentials,
  method: string,
  path: string,
  body?: unknown
): Promise<any> {
  // Get token
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

export async function handleOrders(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  const method = request.method;

  // POST /v1/orders — create order (passthrough to Logiwa native schema)
  if (method === 'POST' && path === '/v1/orders') {
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      throw badRequest('Invalid JSON body');
    }

    // Minimal validation — need at least code and line items
    if (!body.code && !body.shipmentOrderLineList) {
      throw badRequest('Missing required fields: code, shipmentOrderLineList');
    }

    const orderId = crypto.randomUUID();
    const externalOrderId = (body.code as string) || orderId;

    // Store raw payload in R2
    const r2Key = `orders/${tenant.tenantId}/${orderId}/request.json`;
    await env.R2.put(r2Key, JSON.stringify(body));

    // Insert order record in D1
    await env.DB.prepare(
      `INSERT INTO orders (id, tenant_id, external_order_id, status, request_payload_key, created_at, updated_at)
       VALUES (?, ?, ?, 'received', ?, datetime('now'), datetime('now'))`
    )
      .bind(orderId, tenant.tenantId, externalOrderId, r2Key)
      .run();

    // Inject gateway fields — client sends everything else
    const logiwaConfig = await getTenantLogiwaConfig(env, tenant.tenantId);
    const creds = getLogiwaCredentials(env, logiwaConfig.environment, logiwaConfig.clientIdentifier);

    let logiwaOrderId: string | null = null;
    let status = 'received';
    let errorDetail: string | null = null;

    if (creds) {
      // Build payload: client's body + our injected fields
      const payload = {
        ...body,
        clientIdentifier: creds.clientIdentifier,
        warehouseIdentifier: creds.warehouseIdentifier,
        channelName: 'KSP API Gateway',
        shipmentOrderType: body.shipmentOrderType || 'Sales Order',
        shipmentOrderDate: body.shipmentOrderDate || new Date().toISOString().split('T')[0],
        useSameAddress: body.useSameAddress !== undefined ? body.useSameAddress : true,
      };

      try {
        const result = await logiwaFetchDirect(creds, 'POST', '/v3.1/ShipmentOrder/create', payload);
        logiwaOrderId = result.value || result.data || null;
        status = 'sent';

        const responseKey = `orders/${tenant.tenantId}/${orderId}/response.json`;
        await env.R2.put(responseKey, JSON.stringify(result));

        await env.DB.prepare(
          `UPDATE orders SET logiwa_order_id = ?, status = 'sent', response_payload_key = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
          .bind(logiwaOrderId, responseKey, orderId)
          .run();
      } catch (err) {
        errorDetail = err instanceof Error ? err.message : String(err);
        console.error('Logiwa create order failed:', errorDetail);
        status = 'error';
        await env.DB.prepare(
          `UPDATE orders SET status = 'error', updated_at = datetime('now') WHERE id = ?`
        )
          .bind(orderId)
          .run();

        await env.DB.prepare(
          `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
           VALUES (?, '/v1/orders', 'POST', ?, 502, 0, 0, datetime('now'))`
        )
          .bind(tenant.tenantId, errorDetail)
          .run();
      }
    }

    return Response.json(
      {
        orderId,
        code: externalOrderId,
        logiwaOrderId,
        status,
        message: status === 'sent'
          ? 'Order created and sent to Logiwa'
          : status === 'error'
            ? `Order saved but Logiwa submission failed: ${errorDetail}`
            : 'Order received and queued for processing',
      },
      { status: 201 }
    );
  }

  // POST /v1/orders/bulk — bulk create orders (max 50, passthrough to Logiwa)
  if (method === 'POST' && path === '/v1/orders/bulk') {
    let orders: Record<string, unknown>[];
    try {
      orders = await request.json() as Record<string, unknown>[];
    } catch {
      throw badRequest('Invalid JSON body — expected an array of orders');
    }

    if (!Array.isArray(orders)) {
      throw badRequest('Request body must be an array of orders');
    }
    if (orders.length === 0) {
      throw badRequest('Array must contain at least 1 order');
    }
    if (orders.length > 50) {
      throw badRequest('Bulk requests limited to 50 orders maximum');
    }

    const logiwaConfig = await getTenantLogiwaConfig(env, tenant.tenantId);
    const creds = getLogiwaCredentials(env, logiwaConfig.environment, logiwaConfig.clientIdentifier);

    if (!creds) {
      throw badRequest('Logiwa credentials not configured for this environment');
    }

    // Store raw payload in R2
    const bulkId = crypto.randomUUID();
    const r2Key = `orders/${tenant.tenantId}/bulk-${bulkId}/request.json`;
    await env.R2.put(r2Key, JSON.stringify(orders));

    // Inject gateway fields into each order
    const payload = orders.map((order) => ({
      ...order,
      clientIdentifier: creds.clientIdentifier,
      warehouseIdentifier: creds.warehouseIdentifier,
      channelName: 'KSP API Gateway',
      shipmentOrderType: order.shipmentOrderType || 'Sales Order',
      shipmentOrderDate: order.shipmentOrderDate || new Date().toISOString().split('T')[0],
      useSameAddress: order.useSameAddress !== undefined ? order.useSameAddress : true,
    }));

    try {
      const result = await logiwaFetchDirect(creds, 'POST', '/v3.1/ShipmentOrder/create/bulk', payload);

      // Store response in R2
      const responseKey = `orders/${tenant.tenantId}/bulk-${bulkId}/response.json`;
      await env.R2.put(responseKey, JSON.stringify(result));

      // Log each order to D1
      const results = Array.isArray(result) ? result : (result?.data || []);
      for (let i = 0; i < orders.length; i++) {
        const orderId = crypto.randomUUID();
        const code = (orders[i].code as string) || `bulk-${bulkId}-${i}`;
        const logiwaId = results[i]?.value || results[i]?.data || null;
        const orderStatus = results[i]?.bulkErrorType === 0 ? 'sent' : 'error';

        await env.DB.prepare(
          `INSERT INTO orders (id, tenant_id, external_order_id, logiwa_order_id, status, request_payload_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        )
          .bind(orderId, tenant.tenantId, code, logiwaId, orderStatus, r2Key)
          .run();
      }

      return Response.json({
        bulkId,
        count: orders.length,
        results: result,
        message: 'Bulk order submission complete',
      }, { status: 201 });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Logiwa bulk order failed:', errMsg);

      await env.DB.prepare(
        `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
         VALUES (?, '/v1/orders/bulk', 'POST', ?, 502, 0, 0, datetime('now'))`
      ).bind(tenant.tenantId, errMsg).run();

      return Response.json({
        bulkId,
        count: orders.length,
        status: 'error',
        message: errMsg,
      }, { status: 502 });
    }
  }

  // GET /v1/orders/:id — get order status
  const orderMatch = path.match(/^\/v1\/orders\/([^/]+)$/);
  if (method === 'GET' && orderMatch) {
    const orderId = orderMatch[1];

    const row = await env.DB.prepare(
      `SELECT id, external_order_id, logiwa_order_id, status, created_at, updated_at
       FROM orders WHERE id = ? AND tenant_id = ?`
    )
      .bind(orderId, tenant.tenantId)
      .first();

    if (!row) {
      throw notFound(`Order ${orderId} not found`);
    }

    return Response.json({
      orderId: row.id,
      code: row.external_order_id,
      logiwaOrderId: row.logiwa_order_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  throw methodNotAllowed();
}
