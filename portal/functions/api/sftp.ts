interface Env {
  DB: D1Database;
}

// GET /api/sftp?client=xxx&status=xxx&page=1 — list SFTP file activity
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const client = url.searchParams.get('client');
  const status = url.searchParams.get('status');
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  let query = `SELECT sf.id, sf.sftp_username, t.name as tenant_name, sf.file_name, sf.order_code,
    sf.gateway_order_id, sf.status, sf.confirmation_key, sf.last_error, sf.created_at, sf.updated_at
    FROM sftp_files sf LEFT JOIN tenants t ON sf.tenant_id = t.id WHERE 1=1`;
  const params: unknown[] = [];
  if (client) {
    query += ' AND sf.sftp_username = ?';
    params.push(client);
  }
  if (status) {
    query += ' AND sf.status = ?';
    params.push(status);
  }
  query += ' ORDER BY sf.created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const result = await env.DB.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM sftp_files WHERE 1=1';
  const countParams: unknown[] = [];
  if (client) {
    countQuery += ' AND sftp_username = ?';
    countParams.push(client);
  }
  if (status) {
    countQuery += ' AND status = ?';
    countParams.push(status);
  }
  const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();

  const clients = await env.DB.prepare(
    'SELECT sftp_username, enabled FROM sftp_clients ORDER BY sftp_username'
  ).all();

  return Response.json({
    files: result.results,
    clients: clients.results,
    total: (countResult as { total: number })?.total || 0,
    page,
    pageSize,
  });
};
