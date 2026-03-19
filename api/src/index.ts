import { handleRequest } from './routes/router';
import { handleScheduled } from './lib/scheduled';
import { handleQueue } from './lib/queue';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  RETRY_QUEUE: Queue;
  // Logiwa credentials — set once as Worker secrets/vars
  LOGIWA_API_URL: string;            // e.g. https://myapi.logiwa.com
  LOGIWA_USERNAME: string;           // email
  LOGIWA_PASSWORD: string;
  LOGIWA_CLIENT_IDENTIFIER?: string; // Logiwa client GUID
  LOGIWA_WAREHOUSE_IDENTIFIER?: string;
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
