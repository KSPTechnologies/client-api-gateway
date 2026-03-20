import { Env } from '../index';
import { TenantContext } from '../auth';
import { notFound, methodNotAllowed } from '../lib/errors';
import { getLogiwaCredentials, getTenantLogiwaConfig, getShipmentOrder } from '../lib/logiwa';

export async function handleTracking(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  const match = path.match(/^\/v1\/orders\/([^/]+)\/tracking$/);
  if (!match) {
    throw notFound();
  }

  if (request.method !== 'GET') {
    throw methodNotAllowed();
  }

  const orderId = match[1];

  const order = await env.DB.prepare(
    `SELECT id, logiwa_order_id, status FROM orders WHERE id = ? AND tenant_id = ?`
  )
    .bind(orderId, tenant.tenantId)
    .first();

  if (!order) {
    throw notFound(`Order ${orderId} not found`);
  }

  let tracking: any = null;
  let carrier: string | null = null;
  let trackingNumber: string | null = null;
  let estimatedDelivery: string | null = null;

  if (order.logiwa_order_id) {
    const logiwaConfig = await getTenantLogiwaConfig(env, tenant.tenantId);
    const creds = getLogiwaCredentials(env, logiwaConfig.environment, logiwaConfig.clientIdentifier);
    if (creds) {
      try {
        const logiwaOrder = await getShipmentOrder(creds, order.logiwa_order_id as string);
        if (logiwaOrder) {
          carrier = logiwaOrder.carrierName || null;
          trackingNumber = logiwaOrder.trackingNumbers?.[0] || null;
          estimatedDelivery = logiwaOrder.expectedDeliveryDate || null;
          tracking = {
            logiwaStatus: logiwaOrder.shipmentOrderStatusName,
            shipmentDate: logiwaOrder.actualShipmentDate || null,
            trackingNumbers: logiwaOrder.trackingNumbers || [],
            carrier: logiwaOrder.carrierName || null,
            shippingCost: logiwaOrder.totalShippingCost || null,
          };
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('Logiwa tracking fetch failed:', errMsg);
        await env.DB.prepare(
          `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
           VALUES (?, ?, 'GET', ?, 502, 0, 0, datetime('now'))`
        ).bind(tenant.tenantId, `/v1/orders/${orderId}/tracking`, errMsg).run();
      }
    }
  }

  return Response.json({
    orderId: order.id,
    status: order.status,
    tracking,
    carrier,
    trackingNumber,
    estimatedDelivery,
  });
}
