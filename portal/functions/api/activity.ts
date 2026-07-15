interface Env {
  DB: D1Database;
}

// GET /api/activity — merged recent events across every channel + cron health.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const [requests, sftp, zoho, crons] = await Promise.all([
    env.DB.prepare(
      `SELECT r.id, r.tenant_id, t.name as tenant_name, r.method, r.path, r.status_code, r.error_message, r.created_at
       FROM request_log r LEFT JOIN tenants t ON r.tenant_id = t.id
       ORDER BY r.created_at DESC LIMIT 40`
    ).all(),
    env.DB.prepare(
      `SELECT id, sftp_username, file_name, order_code, gateway_order_id, status, last_error, created_at, updated_at
       FROM sftp_files ORDER BY updated_at DESC LIMIT 40`
    ).all(),
    env.DB.prepare(
      `SELECT id, tenant_id, zoho_record_id, order_code, gateway_order_id, source, inbound_status, writeback_status, last_error, created_at, updated_at
       FROM zoho_sync ORDER BY updated_at DESC LIMIT 40`
    ).all(),
    env.DB.prepare(`SELECT cron, last_run_at, last_status, detail FROM cron_runs`).all(),
  ]);

  type Ev = {
    at: string; type: string; who: string; what: string; status: string; error: string | null; orderId: string | null;
  };
  const events: Ev[] = [];

  for (const r of requests.results as any[]) {
    events.push({
      at: r.created_at,
      type: r.path?.startsWith('/v1/webhooks/zoho') ? 'zoho' : 'api',
      who: r.tenant_name || r.tenant_id,
      what: `${r.method} ${r.path} → ${r.status_code}`,
      status: r.status_code >= 400 ? 'error' : 'ok',
      error: r.error_message || null,
      orderId: null,
    });
  }
  for (const s of sftp.results as any[]) {
    events.push({
      at: s.updated_at || s.created_at,
      type: 'sftp',
      who: s.sftp_username,
      what: `file ${s.file_name}${s.order_code ? ` (order ${s.order_code})` : ''} → ${s.status}`,
      status: s.status === 'error' ? 'error' : 'ok',
      error: s.last_error || null,
      orderId: s.gateway_order_id || null,
    });
  }
  for (const z of zoho.results as any[]) {
    events.push({
      at: z.updated_at || z.created_at,
      type: 'zoho',
      who: 'zoho:' + (z.zoho_record_id || '').slice(0, 12),
      what: `record${z.order_code ? ` (order ${z.order_code})` : ''} → in:${z.inbound_status} / wb:${z.writeback_status}`,
      status: z.inbound_status === 'error' ? 'error' : 'ok',
      error: z.last_error || null,
      orderId: z.gateway_order_id || null,
    });
  }

  events.sort((a, b) => (b.at || '').localeCompare(a.at || ''));

  return Response.json({
    events: events.slice(0, 80),
    crons: crons.results,
  });
};
