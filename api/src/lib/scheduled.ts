import { Env } from '../index';
import { getLogiwaCredentials, getShipmentOrder, queryInventory } from './logiwa';

export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  switch (event.cron) {
    case '*/15 * * * *':
      await syncTracking(env);
      break;

    case '0 * * * *':
      await refreshInventoryCache(env);
      break;

    default:
      console.log(`Unknown cron: ${event.cron}`);
  }
}

async function syncTracking(env: Env): Promise<void> {
  const creds = await getLogiwaCredentials(env);
  if (!creds) return;

  const { results: orders } = await env.DB.prepare(
    `SELECT o.id, o.tenant_id, o.logiwa_order_id, o.external_order_id, t.callback_url
     FROM orders o
     JOIN tenants t ON t.id = o.tenant_id
     WHERE o.status = 'sent' AND o.logiwa_order_id IS NOT NULL
     ORDER BY o.created_at ASC
     LIMIT 50`
  ).all();

  if (!orders || orders.length === 0) return;

  for (const order of orders) {
    try {
      const logiwaOrder = await getShipmentOrder(creds, order.logiwa_order_id as string);
      if (!logiwaOrder) continue;

      const logiwaStatus = logiwaOrder.shipmentOrderStatusName?.toLowerCase();
      const trackingNumbers = logiwaOrder.trackingNumbers || [];

      let newStatus: string | null = null;
      if (logiwaStatus === 'shipped' || trackingNumbers.length > 0) {
        newStatus = 'fulfilled';
      } else if (logiwaStatus === 'cancelled') {
        newStatus = 'closed';
      }

      if (newStatus) {
        await env.DB.prepare(
          `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`
        )
          .bind(newStatus, order.id)
          .run();

        const callbackUrl = order.callback_url as string;
        if (callbackUrl && trackingNumbers.length > 0) {
          try {
            await fetch(callbackUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'tracking_update',
                orderId: order.id,
                externalOrderId: order.external_order_id,
                status: newStatus,
                carrier: logiwaOrder.carrierName,
                trackingNumbers,
              }),
            });
          } catch (err) {
            console.error(`Callback failed for order ${order.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error(`Tracking sync failed for order ${order.id}:`, err);
    }
  }
}

async function refreshInventoryCache(env: Env): Promise<void> {
  const creds = await getLogiwaCredentials(env);
  if (!creds) return;

  const { results: tenants } = await env.DB.prepare(
    `SELECT id FROM tenants WHERE active = 1`
  ).all();

  if (!tenants || tenants.length === 0) return;

  for (const tenant of tenants) {
    const tenantId = tenant.id as string;

    try {
      const { results: cachedSkus } = await env.DB.prepare(
        `SELECT sku FROM inventory_cache WHERE tenant_id = ?`
      )
        .bind(tenantId)
        .all();

      if (!cachedSkus || cachedSkus.length === 0) continue;

      const skus = cachedSkus.map((r: any) => r.sku as string);
      const items = await queryInventory(creds, skus);

      for (const item of items) {
        await env.DB.prepare(
          `INSERT INTO inventory_cache (tenant_id, sku, quantity, last_synced_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT (tenant_id, sku) DO UPDATE SET quantity = ?, last_synced_at = datetime('now')`
        )
          .bind(tenantId, item.productSku, item.availableQuantity, item.availableQuantity)
          .run();
      }
    } catch (err) {
      console.error(`Inventory refresh failed for tenant ${tenantId}:`, err);
    }
  }
}
