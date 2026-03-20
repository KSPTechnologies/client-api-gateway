import { Env } from '../index';

/**
 * Handles incoming webhooks from Logiwa (bulk results, status changes, etc.)
 * No API key auth — Logiwa sends these directly.
 */
export async function handleWebhooks(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Store raw webhook payload in R2 for debugging
  const webhookId = crypto.randomUUID();
  const r2Key = `webhooks/${webhookId}.json`;
  await env.R2.put(r2Key, JSON.stringify({ path, receivedAt: new Date().toISOString(), body }));

  // Log to request_log
  await env.DB.prepare(
    `INSERT INTO request_log (tenant_id, method, path, status_code, error_message, created_at)
     VALUES ('system', 'POST', ?, 200, ?, datetime('now'))`
  ).bind(path, `Webhook received: ${webhookId}`).run();

  console.log(`Webhook received on ${path}:`, JSON.stringify(body).substring(0, 500));

  return Response.json({ received: true, webhookId });
}
