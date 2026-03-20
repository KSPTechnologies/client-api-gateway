import { Env } from '../index';
import { TenantContext } from '../auth';
import { createPurchaseOrderSchema } from '../lib/validate';
import { badRequest, methodNotAllowed, notFound } from '../lib/errors';
import { getLogiwaCredentials, getTenantLogiwaConfig, createPurchaseOrder, getPurchaseOrder, getPurchaseOrderReceipts } from '../lib/logiwa';

export async function handlePurchaseOrders(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  const method = request.method;
  const logiwaConfig = await getTenantLogiwaConfig(env, tenant.tenantId);
  const creds = getLogiwaCredentials(env, logiwaConfig.environment, logiwaConfig.clientIdentifier);

  // POST /v1/purchase-orders — create purchase order
  if (method === 'POST' && path === '/v1/purchase-orders') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw badRequest('Invalid JSON body');
    }

    const parsed = createPurchaseOrderSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw badRequest(`Validation failed: ${issues.join('; ')}`);
    }

    const po = parsed.data;

    // Store raw payload in R2
    const poId = crypto.randomUUID();
    const r2Key = `purchase-orders/${tenant.tenantId}/${poId}/request.json`;
    await env.R2.put(r2Key, JSON.stringify(po));

    if (!creds) {
      throw badRequest('Logiwa credentials not configured for this environment');
    }

    try {
      const result = await createPurchaseOrder(creds, {
        code: po.code,
        vendor: po.vendor,
        purchaseOrderDate: po.purchaseOrderDate,
        plannedReceivingDate: po.plannedReceivingDate,
        plannedArrivalDate: po.plannedArrivalDate,
        referenceNumber: po.referenceNumber,
        purchaseOrderLineList: po.items.map((item) => ({
          sku: item.sku,
          packType: item.packType,
          packQuantity: item.quantity,
          unitPrice: item.unitPrice,
          lotBatchNumber: item.lotBatchNumber,
        })),
        vendorBillingAddress: po.vendorBillingAddress,
        vendorShipmentAddress: po.vendorShipmentAddress,
      });

      // Store response in R2
      const responseKey = `purchase-orders/${tenant.tenantId}/${poId}/response.json`;
      await env.R2.put(responseKey, JSON.stringify(result));

      return Response.json({
        purchaseOrderId: poId,
        logiwaIdentifier: result.identifier,
        code: po.code,
        status: 'sent',
        message: 'Purchase order created in Logiwa',
      }, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create purchase order';
      return Response.json({
        purchaseOrderId: poId,
        code: po.code,
        status: 'error',
        message,
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
      if (err instanceof Error && err.message.includes('not found')) throw err;
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
