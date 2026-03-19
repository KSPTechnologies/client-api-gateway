import { Env } from '../index';
import { getLogiwaCredentials, createShipmentOrder } from './logiwa';

interface RetryMessage {
  type: 'create_order';
  tenantId: string;
  orderId: string;
  payload: any;
}

export async function handleQueue(
  batch: MessageBatch,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const msg = message.body as RetryMessage;

      if (msg.type === 'create_order') {
        const creds = await getLogiwaCredentials(env, msg.tenantId);
        if (!creds) {
          console.error(`No credentials for tenant ${msg.tenantId}`);
          message.ack(); // Don't retry if tenant doesn't exist
          continue;
        }

        const result = await createShipmentOrder(creds, env, msg.payload);

        // Update order record with Logiwa ID
        const responseKey = `orders/${msg.tenantId}/${msg.orderId}/response.json`;
        await env.R2.put(responseKey, JSON.stringify(result));

        await env.DB.prepare(
          `UPDATE orders SET logiwa_order_id = ?, status = 'sent', response_payload_key = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
          .bind(result.identifier, responseKey, msg.orderId)
          .run();

        // Update retry count in error log
        await env.DB.prepare(
          `UPDATE error_log SET resolved = 1 WHERE tenant_id = ? AND endpoint = '/v1/orders' AND resolved = 0
           ORDER BY created_at DESC LIMIT 1`
        )
          .bind(msg.tenantId)
          .run();

        console.log(`Retry succeeded for order ${msg.orderId}`);
        message.ack();
      } else {
        console.log(`Unknown message type: ${(msg as any).type}`);
        message.ack();
      }
    } catch (e) {
      console.error('Queue message failed:', e);
      message.retry();
    }
  }
}
