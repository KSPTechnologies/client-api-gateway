interface Env {
  DB: D1Database;
}

// GET /api/aftership?tenant_id=&status=&page=1 — push history
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id');
  const status = url.searchParams.get('status');
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  let where = ' WHERE 1=1';
  const params: unknown[] = [];
  if (tenantId) { where += ' AND p.tenant_id = ?'; params.push(tenantId); }
  if (status) { where += ' AND p.status = ?'; params.push(status); }

  const result = await env.DB.prepare(
    `SELECT p.id, p.tenant_id, t.name as tenant_name, o.external_order_id as order_code,
            p.tracking_number, p.aftership_id, p.status, p.last_error, p.created_at, p.updated_at
     FROM aftership_pushes p
     LEFT JOIN tenants t ON p.tenant_id = t.id
     LEFT JOIN orders o ON o.id = p.order_id
     ${where}
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();

  const count = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM aftership_pushes p${where}`
  ).bind(...params).first();

  return Response.json({
    pushes: result.results,
    total: (count as { total: number })?.total || 0,
    page,
    pageSize,
  });
};
