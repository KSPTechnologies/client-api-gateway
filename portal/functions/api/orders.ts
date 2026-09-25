interface Env {
  DB: D1Database;
}

// GET /api/orders?tenant_id=&status=&source=&q=&page=1
// Unified view: every order AND purchase order regardless of channel, with a
// derived `source` (api | sftp | zoho), a `record_type` (order | po), and a
// per-record error message where we have one.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id');
  const status = url.searchParams.get('status');
  const source = url.searchParams.get('source');
  const q = url.searchParams.get('q');
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  // ── orders half ──
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

  const orderSelect = `SELECT o.id, o.tenant_id, o.external_order_id, o.logiwa_order_id, o.status,
    o.environment, o.created_at, o.updated_at, t.name as tenant_name,
    'order' as record_type,
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
    ${fromClause}${where}`;

  // ── purchase-orders half (migration 0013; both channels record here) ──
  // A PO ingested via SFTP has a matching sftp_files row on its r2/file
  // linkage only by order_code, so derive source from that.
  let poWhere = ' WHERE 1=1';
  const poParams: unknown[] = [];
  if (tenantId) { poWhere += ' AND p.tenant_id = ?'; poParams.push(tenantId); }
  if (status) { poWhere += ' AND p.status = ?'; poParams.push(status); }
  if (q) { poWhere += ' AND (p.external_code LIKE ? OR p.id LIKE ? OR p.logiwa_po_id LIKE ?)'; poParams.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (source === 'sftp') poWhere += ' AND sf.id IS NOT NULL';
  else if (source === 'zoho') poWhere += ' AND 1=0';
  else if (source === 'api') poWhere += ' AND sf.id IS NULL';

  const poFromClause = `FROM purchase_orders p
    JOIN tenants t ON p.tenant_id = t.id
    LEFT JOIN sftp_files sf ON sf.order_code = p.external_code AND sf.tenant_id = p.tenant_id`;

  const poSelect = `SELECT p.id, p.tenant_id, p.external_code as external_order_id, p.logiwa_po_id as logiwa_order_id,
    p.status, p.environment, p.created_at, p.updated_at, t.name as tenant_name,
    'po' as record_type,
    CASE WHEN sf.id IS NOT NULL THEN 'sftp' ELSE 'api' END as source,
    sf.file_name as sftp_file, sf.status as sftp_status, NULL as sftp_confirmation,
    NULL as zoho_record, NULL as zoho_writeback,
    p.last_error
    ${poFromClause}${poWhere}`;

  const unioned = `SELECT * FROM (${orderSelect} UNION ALL ${poSelect})
    ORDER BY created_at DESC LIMIT ? OFFSET ?`;

  const result = await env.DB.prepare(unioned)
    .bind(...params, ...poParams, pageSize, offset).all();

  const countResult = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) ${fromClause}${where}) + (SELECT COUNT(*) ${poFromClause}${poWhere}) as total`
  ).bind(...params, ...poParams).first();

  return Response.json({
    orders: result.results,
    total: (countResult as { total: number })?.total || 0,
    page,
    pageSize,
  });
};
