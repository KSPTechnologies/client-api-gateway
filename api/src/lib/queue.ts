import { Env } from '../index';
import { getLogiwaCredentials, getTenantLogiwaConfig, createShipmentOrder } from './logiwa';

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
        const config = await getTenantLogiwaConfig(env, msg.tenantId);
        const creds = getLogiwaCredentials(env, config.environment, config.clientIdentifier);
        if (!creds) {
          console.error(`No Logiwa ${tenantEnv} credentials configured`);
          message.ack();
          continue;
        }

        const result = await createShipmentOrder(creds, msg.payload);

        const responseKey = `orders/${msg.tenantId}/${msg.orderId}/response.json`;
        await env.R2.put(responseKey, JSON.stringify(result));

        await env.DB.prepare(
          `UPDATE orders SET logiwa_order_id = ?, status = 'sent', response_payload_key = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
          .bind(result.identifier, responseKey, msg.orderId)
          .run();

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
