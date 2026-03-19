import { Env } from '../index';

export async function handleQueue(
  batch: MessageBatch,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const payload = message.body as {
        tenantId: string;
        endpoint: string;
        method: string;
        body: unknown;
      };

      // TODO: Phase 4 — retry the failed Logiwa API call
      console.log(`Retrying ${payload.method} ${payload.endpoint} for tenant ${payload.tenantId}`);

      message.ack();
    } catch (e) {
      console.error('Queue message failed:', e);
      message.retry();
    }
  }
}
