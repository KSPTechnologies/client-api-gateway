import { handleRequest } from './routes/router';
import { handleScheduled } from './lib/scheduled';
import { handleQueue } from './lib/queue';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  RETRY_QUEUE: Queue;
  // Logiwa Production credentials
  LOGIWA_PROD_API_URL: string;
  LOGIWA_PROD_USERNAME: string;
  LOGIWA_PROD_PASSWORD: string;
  LOGIWA_PROD_CLIENT_IDENTIFIER?: string;
  LOGIWA_PROD_WAREHOUSE_IDENTIFIER?: string;
  // Logiwa Sandbox credentials
  LOGIWA_SANDBOX_API_URL: string;
  LOGIWA_SANDBOX_USERNAME: string;
  LOGIWA_SANDBOX_PASSWORD: string;
  LOGIWA_SANDBOX_CLIENT_IDENTIFIER?: string;
  LOGIWA_SANDBOX_WAREHOUSE_IDENTIFIER?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    return handleScheduled(event, env, ctx);
  },

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    return handleQueue(batch, env);
  },
};
