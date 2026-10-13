interface Env {
  DB: D1Database;
}

// SpeeDee adapter call log (speedee_call_log, migration 0016) for the portal's
// SpeeDee page: list (no payloads) + single-row detail with pretty payloads.

function pretty(s: string | null): string | null {
  if (!s) return null;
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

// GET /api/speedee-log?endpoint=&status=&q=&page=1   (list)
// GET /api/speedee-log?id=<row id>                   (detail with payloads)
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (id) {
    const row = (await env.DB.prepare(`SELECT * FROM speedee_call_log WHERE id = ?`).bind(id).first()) as any;
    if (!row) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({
      ...row,
      request_json: pretty(row.request_json),
      response_json: pretty(row.response_json),
    });
  }

  const endpoint = url.searchParams.get('endpoint');
  const status = url.searchParams.get('status'); // 'ok' | 'fail'
  const q = url.searchParams.get('q');
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = 50;

  let where = ' WHERE 1=1';
  const params: unknown[] = [];
  if (endpoint) { where += ' AND endpoint = ?'; params.push(endpoint); }
  if (status === 'ok') where += ' AND is_successful = 1';
  else if (status === 'fail') where += ' AND is_successful = 0';
  if (q) {
    where += ' AND (shipment_order_code LIKE ? OR shipment_order_identifier LIKE ? OR speedee_order_id LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const rows = await env.DB.prepare(
    `SELECT id, endpoint, environment, shipment_order_code, shipment_order_identifier, speedee_order_id,
            is_successful, duration_ms, message, created_at
     FROM speedee_call_log${where}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, (page - 1) * pageSize).all();

  const count = (await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM speedee_call_log${where}`
  ).bind(...params).first()) as any;

  return Response.json({ calls: rows.results || [], total: count?.total || 0, page, pageSize });
};
