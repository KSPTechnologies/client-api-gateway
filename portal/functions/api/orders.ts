interface Env {
  DB: D1Database;
}

// GET /api/orders?tenant_id=&status=&source=&q=&page=1
// Unified orders view: every order regardless of channel, with a derived
// `source` (api | sftp | zoho) and a per-order error message where we have one.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id');
  const status = url.searchParams.get('status');
  const source = url.searchParams.get('source');
  const q = url.searchParams.get('q');
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  let where = ' WHERE 1=1';
  const params: unknown[] = [];

  if (tenantId) { where += ' AND o.tenant_id = ?'; params.push(tenantId); }
  if (status) { where += ' AND o.status = ?'; params.push(status); }
  if (q) { where += ' AND (o.external_order_id LIKE ? OR o.id LIKE ? OR o.logiwa_order_id LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (source === 'sftp') where += ' AND sf.id IS NOT NULL';
  else if (source === 'zoho') where += ' AND z.id IS NOT NULL';
  else if (source === 'api') where += ' AND sf.id IS NULL AND z.id IS NULL';

  const fromClause = `FROM orders o
    JOIN tenants t ON o.tenant_id = t.id
    LEFT JOIN sftp_files sf ON sf.gateway_order_id = o.id
    LEFT JOIN zoho_sync z ON z.gateway_order_id = o.id`;

  const query = `SELECT o.*, t.name as tenant_name,
    CASE WHEN sf.id IS NOT NULL THEN 'sftp' WHEN z.id IS NOT NULL THEN 'zoho' ELSE 'api' END as source,
    sf.file_name as sftp_file, sf.status as sftp_status, sf.confirmation_key as sftp_confirmation,
    z.zoho_record_id as zoho_record, z.writeback_status as zoho_writeback,
    COALESCE(sf.last_error, z.last_error,
      CASE WHEN o.status = 'error' THEN (
        SELECT e.error_message FROM error_log e
        WHERE e.tenant_id = o.tenant_id AND e.method = 'POST' AND e.endpoint LIKE '/v1/orders%'
          AND e.created_at BETWEEN datetime(o.created_at, '-10 seconds') AND datetime(o.updated_at, '+10 seconds')
        ORDER BY e.created_at DESC LIMIT 1
      ) END) as last_error
    ${fromClause}${where}
    ORDER BY o.created_at DESC LIMIT ? OFFSET ?`;

  const result = await env.DB.prepare(query).bind(...params, pageSize, offset).all();

  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) as total ${fromClause}${where}`
  ).bind(...params).first();

  return Response.json({
    orders: result.results,
    total: (countResult as { total: number })?.total || 0,
    page,
    pageSize,
  });
};
