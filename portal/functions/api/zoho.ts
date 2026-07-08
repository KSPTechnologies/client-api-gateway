interface Env {
  DB: D1Database;
}

// GET /api/zoho?tenant_id=xxx&status=xxx&page=1 — list Zoho sync events
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id');
  const status = url.searchParams.get('status'); // filters inbound_status
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  let query = `SELECT z.id, z.tenant_id, t.name as tenant_name, z.zoho_record_id, z.order_code,
    z.gateway_order_id, z.source, z.inbound_status, z.writeback_status, z.last_error,
    z.created_at, z.updated_at
    FROM zoho_sync z JOIN tenants t ON z.tenant_id = t.id WHERE 1=1`;
  const params: unknown[] = [];

  if (tenantId) {
    query += ' AND z.tenant_id = ?';
    params.push(tenantId);
  }
  if (status) {
    query += ' AND z.inbound_status = ?';
    params.push(status);
  }

  query += ' ORDER BY z.created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const result = await env.DB.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM zoho_sync WHERE 1=1';
  const countParams: unknown[] = [];
  if (tenantId) {
    countQuery += ' AND tenant_id = ?';
    countParams.push(tenantId);
  }
  if (status) {
    countQuery += ' AND inbound_status = ?';
    countParams.push(status);
  }

  const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();

  return Response.json({
    events: result.results,
    total: (countResult as { total: number })?.total || 0,
    page,
    pageSize,
  });
};
