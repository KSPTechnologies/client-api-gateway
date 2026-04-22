import { Env } from '../index';
import { TenantContext } from '../auth';
import { badRequest, methodNotAllowed, notFound } from '../lib/errors';
import { getLogiwaCredentials, getTenantLogiwaConfig, getPurchaseOrder, getPurchaseOrderReceipts, getPurchaseOrderDetail, findPurchaseOrderByCode, LogiwaCredentials } from '../lib/logiwa';
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
  const logiwaConfig = await getTenantLogiwaConfig(env, tenant.tenantId, tenant.environment);
  const creds = getLogiwaCredentials(env, logiwaConfig.environment, logiwaConfig.clientIdentifier);

  // GET /v1/purchase-orders — list purchase orders (passthrough to Logiwa with tenant scoping)
  if (method === 'GET' && path === '/v1/purchase-orders') {
    if (!creds) {
      throw badRequest('Logiwa credentials not configured for this environment');
    }

    const url = new URL(request.url);
    const page = Math.max(0, parseInt(url.searchParams.get('page') || '1') - 1);
    const size = parseInt(url.searchParams.get('size') || '50');

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
      const result = await logiwaFetchDirect(creds, 'GET', `/v3.1/PurchaseOrder/list/i/${page}/s/${size}?${filterParams.toString()}`);
      return Response.json(result);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Logiwa list purchase orders failed:', errMsg);

      await env.DB.prepare(
        `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
         VALUES (?, '/v1/purchase-orders', 'GET', ?, 502, 0, 0, datetime('now'))`
      ).bind(tenant.tenantId, errMsg).run();

      return Response.json({ error: errMsg }, { status: 502 });
    }
  }

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
      purchaseOrderTypeName: body.purchaseOrderTypeName || 'Purchase Order',
      purchaseOrderDate: body.purchaseOrderDate || new Date().toISOString().split('T')[0],
      currencyId: body.currencyId || '1',
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

  // GET /v1/purchase-orders/:id/receipts — get PO line-level receiving status
  const receiptsMatch = path.match(/^\/v1\/purchase-orders\/([^/]+)\/receipts$/);
  if (method === 'GET' && receiptsMatch) {
    const poCode = receiptsMatch[1];

    if (!creds) {
      throw badRequest('Logiwa credentials not configured for this environment');
    }

    try {
      // Look up the PO identifier from the code
      const po = await findPurchaseOrderByCode(creds, poCode);
      if (!po) throw notFound(`Purchase order ${poCode} not found`);

      // Fetch detail (line-level ordered/received totals) and receiving history
      // (per-event receipts with date, qty, difference, damage) in parallel.
      const receiptFilters: Record<string, string> = { 'Code.eq': poCode };
      if (creds.clientIdentifier) {
        receiptFilters['ClientIdentifier.eq'] = creds.clientIdentifier;
      }
      const [detail, receiptEvents] = await Promise.all([
        getPurchaseOrderDetail(creds, po.identifier),
        getPurchaseOrderReceipts(creds, 0, 500, receiptFilters),
      ]);
      if (!detail) throw notFound(`Purchase order detail for ${poCode} not found`);

      // Group receipt events by SKU, dropping Logiwa's "never received" sentinel date.
      const eventsBySku = new Map<string, any[]>();
      for (const ev of receiptEvents || []) {
        const sku = ev.productSku;
        if (!sku) continue;
        const rawDate = ev.receiptDate;
        const receiptDate = (!rawDate || rawDate.startsWith('0001-01-01')) ? null : rawDate;
        if (!receiptDate) continue; // skip empty sentinel rows — they add no info
        if (!eventsBySku.has(sku)) eventsBySku.set(sku, []);
        eventsBySku.get(sku)!.push({
          receiptDate,
          receivedQuantity: ev.receivedUOMQuantity ?? ev.uomQuantity ?? 0,
          packQuantity: ev.packQuantity ?? 0,
          packType: ev.packTypeName ?? null,
          receiptDifference: ev.receiptDifference ?? 0,
          damagedQuantity: ev.damageReceivedQuantity ?? 0,
          warehouseCode: ev.warehouseCode ?? null,
        });
      }

      // Sort each SKU's events newest-first so the client sees the latest receipt first.
      for (const list of eventsBySku.values()) {
        list.sort((a, b) => (b.receiptDate || '').localeCompare(a.receiptDate || ''));
      }

      const lines = (detail.purchaseOrderLineList || []).map((line: any) => {
        const events = eventsBySku.get(line.sku) || [];
        const ordered = line.linePackQuantity || 0;
        const received = line.receivedQuantity || 0;
        return {
          sku: line.sku,
          name: line.name,
          orderedQuantity: ordered,
          receivedQuantity: received,
          shortQuantity: Math.max(0, ordered - received),
          packType: line.linePackTypeName || 'Unit',
          isFullyReceived: received >= ordered,
          lastReceivedDate: events[0]?.receiptDate || null,
          receiptEvents: events,
        };
      });

      const totalOrdered = lines.reduce((sum: number, l: any) => sum + l.orderedQuantity, 0);
      const totalReceived = lines.reduce((sum: number, l: any) => sum + l.receivedQuantity, 0);
      const totalDamaged = lines.reduce(
        (sum: number, l: any) => sum + l.receiptEvents.reduce((s: number, e: any) => s + (e.damagedQuantity || 0), 0),
        0
      );

      return Response.json({
        purchaseOrderCode: poCode,
        purchaseOrderIdentifier: po.identifier,
        status: detail.purchaseOrderStatus || 'Pending',
        totalOrdered,
        totalReceived,
        totalShort: Math.max(0, totalOrdered - totalReceived),
        totalDamaged,
        isFullyReceived: totalReceived >= totalOrdered && totalOrdered > 0,
        lineItems: lines,
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('PO receipts fetch failed:', errMsg);

      await env.DB.prepare(
        `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
         VALUES (?, ?, 'GET', ?, 502, 0, 0, datetime('now'))`
      ).bind(tenant.tenantId, `/v1/purchase-orders/${poCode}/receipts`, errMsg).run();

      return Response.json({ error: errMsg }, { status: 502 });
    }
  }

  throw methodNotAllowed();
}
