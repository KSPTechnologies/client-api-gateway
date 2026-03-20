interface Env {
  DB: D1Database;
}

// POST /api/environment — toggle a client's Logiwa environment
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json() as {
    tenant_id: string;
    environment: 'sandbox' | 'production';
  };

  if (!body.tenant_id) {
    return Response.json({ error: 'Missing tenant_id' }, { status: 400 });
  }

  if (body.environment !== 'sandbox' && body.environment !== 'production') {
    return Response.json({ error: 'Must be "sandbox" or "production"' }, { status: 400 });
  }

  await env.DB.prepare(
    `UPDATE tenants SET logiwa_environment = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(body.environment, body.tenant_id).run();

  return Response.json({ tenant_id: body.tenant_id, environment: body.environment });
};
