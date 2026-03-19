import { Env } from '../index';
import { TenantContext } from '../auth';
import { createOrderSchema } from '../lib/validate';
import { badRequest, methodNotAllowed, notFound, internal } from '../lib/errors';
import { getLogiwaCredentials, createShipmentOrder, getShipmentOrder } from '../lib/logiwa';

export async function handleOrders(
  request: Request,
  env: Env,
  tenant: TenantContext,
  path: string
): Promise<Response> {
  const method = request.method;

  // POST /v1/orders — create order
  if (method === 'POST' && path === '/v1/orders') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw badRequest('Invalid JSON body');
    }

    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw badRequest(`Validation failed: ${issues.join('; ')}`);
    }

    const order = parsed.data;
    const orderId = crypto.randomUUID();

    // Store raw payload in R2
    const r2Key = `orders/${tenant.tenantId}/${orderId}/request.json`;
    await env.R2.put(r2Key, JSON.stringify(order));

    // Insert order record in D1
    await env.DB.prepare(
      `INSERT INTO orders (id, tenant_id, external_order_id, status, request_payload_key, created_at, updated_at)
       VALUES (?, ?, ?, 'received', ?, datetime('now'), datetime('now'))`
    )
      .bind(orderId, tenant.tenantId, order.externalOrderId, r2Key)
      .run();

    // Forward to Logiwa
    let logiwaOrderId: string | null = null;
    let status = 'received';

    const creds = await getLogiwaCredentials(env, tenant.tenantId);
    if (creds) {
      try {
        // Split name into first/last for Logiwa
        const nameParts = order.shipTo.name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || nameParts[0];

        const result = await createShipmentOrder(creds, env, {
          code: order.externalOrderId,
          customer: {
            firstName,
            lastName,
            email: order.shipTo.email,
          },
          shipmentAddress: {
            addressLine1: order.shipTo.address1,
            addressLine2: order.shipTo.address2,
            city: order.shipTo.city,
            state: order.shipTo.state,
            postalCode: order.shipTo.zip,
            country: order.shipTo.country,
            phoneNumber: order.shipTo.phone,
          },
          shipmentOrderLineList: order.items.map((item) => ({
            sku: item.sku,
            packQuantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
          note: order.notes,
          clientReferenceCode: order.referenceNumber,
        });

        logiwaOrderId = result.identifier;
        status = 'sent';

        // Store Logiwa response in R2
        const responseKey = `orders/${tenant.tenantId}/${orderId}/response.json`;
        await env.R2.put(responseKey, JSON.stringify(result));

        // Update order with Logiwa ID
        await env.DB.prepare(
          `UPDATE orders SET logiwa_order_id = ?, status = 'sent', response_payload_key = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
          .bind(logiwaOrderId, responseKey, orderId)
          .run();
      } catch (err) {
        // Order is saved locally — Logiwa send failed, will be retried
        console.error('Logiwa create order failed:', err);
        status = 'error';
        await env.DB.prepare(
          `UPDATE orders SET status = 'error', updated_at = datetime('now') WHERE id = ?`
        )
          .bind(orderId)
          .run();
      }
    }

    return Response.json(
      {
        orderId,
        externalOrderId: order.externalOrderId,
        logiwaOrderId,
        status,
        message: status === 'sent'
          ? 'Order created and sent to Logiwa'
          : status === 'error'
            ? 'Order saved but Logiwa submission failed — will be retried'
            : 'Order received and queued for processing',
      },
      { status: 201 }
    );
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
      externalOrderId: row.external_order_id,
      logiwaOrderId: row.logiwa_order_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  throw methodNotAllowed();
}
