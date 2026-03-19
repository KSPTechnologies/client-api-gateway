interface Env {
  DB: D1Database;
}

// GET /api/orders?tenant_id=xxx&status=xxx&page=1
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id');
  const status = url.searchParams.get('status');
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  let query = `SELECT o.*, t.name as tenant_name FROM orders o JOIN tenants t ON o.tenant_id = t.id WHERE 1=1`;
  const params: unknown[] = [];

  if (tenantId) {
    query += ' AND o.tenant_id = ?';
    params.push(tenantId);
  }
  if (status) {
    query += ' AND o.status = ?';
    params.push(status);
  }

  query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const result = await env.DB.prepare(query).bind(...params).all();

  // Get total count for pagination
  let countQuery = 'SELECT COUNT(*) as total FROM orders WHERE 1=1';
  const countParams: unknown[] = [];
  if (tenantId) {
    countQuery += ' AND tenant_id = ?';
    countParams.push(tenantId);
  }
  if (status) {
    countQuery += ' AND status = ?';
    countParams.push(status);
  }

  const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();

  return Response.json({
    orders: result.results,
    total: (countResult as { total: number })?.total || 0,
    page,
    pageSize,
  });
};
