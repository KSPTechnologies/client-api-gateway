import { Env } from '../index';

export async function logRequest(
  env: Env,
  tenantId: string,
  request: Request,
  response: Response,
  errorMessage?: string
): Promise<void> {
  try {
    const url = new URL(request.url);
    await env.DB.prepare(
      `INSERT INTO request_log (tenant_id, method, path, status_code, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(tenantId, request.method, url.pathname, response.status, errorMessage || null)
      .run();

    // If error, also log to error_log for the portal retry queue
    if (errorMessage) {
      await env.DB.prepare(
        `INSERT INTO error_log (tenant_id, endpoint, method, error_message, error_code, retry_count, resolved, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, datetime('now'))`
      )
        .bind(tenantId, url.pathname, request.method, errorMessage, response.status)
        .run();
    }
  } catch (e) {
    // Logging should never break the request
    console.error('Failed to log request:', e);
  }
}
