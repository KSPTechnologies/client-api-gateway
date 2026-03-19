interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

// GET /api/tenants — list all tenants
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const result = await env.DB.prepare(
    'SELECT id, name, callback_url, active, created_at, updated_at FROM tenants ORDER BY created_at DESC'
  ).all();

  return Response.json(result.results);
};

// POST /api/tenants — create a tenant
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json() as {
    name: string;
    logiwa_api_url: string;
    logiwa_credentials: string;
    callback_url?: string;
  };

  if (!body.name || !body.logiwa_api_url || !body.logiwa_credentials) {
    return Response.json({ error: 'Missing required fields: name, logiwa_api_url, logiwa_credentials' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO tenants (id, name, logiwa_api_url, logiwa_credentials, callback_url, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
  )
    .bind(id, body.name, body.logiwa_api_url, body.logiwa_credentials, body.callback_url || null)
    .run();

  return Response.json({ id, name: body.name }, { status: 201 });
};
