interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

// GET /api/aftership-clients — enabled tenants + selectable tenant list
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const accounts = await env.DB.prepare(
    `SELECT a.tenant_id, t.name as tenant_name, a.enabled, a.enabled_at, a.created_at
     FROM aftership_accounts a LEFT JOIN tenants t ON a.tenant_id = t.id
     ORDER BY a.created_at DESC`
  ).all();
  const tenants = await env.DB.prepare(
    `SELECT id, name FROM tenants WHERE active = 1 ORDER BY name`
  ).all();

  // Flag which accounts actually have credentials stored (without exposing them).
  const withCreds = await Promise.all(
    (accounts.results as any[]).map(async (a) => {
      const creds = await env.KV.get(`aftership:${a.tenant_id}`);
      return { ...a, has_credentials: !!creds };
    })
  );

  return Response.json({ accounts: withCreds, tenants: tenants.results });
};

// POST /api/aftership-clients — enable (default), or { action: 'toggle' | 'remove' }
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as {
    action?: 'toggle' | 'remove';
    tenant_id?: string;
    enabled?: number;
    api_key?: string;
    webhook_secret?: string;
  };

  const tenantId = (body.tenant_id || '').trim();
  if (!tenantId) return Response.json({ error: 'tenant_id is required' }, { status: 400 });

  if (body.action === 'toggle') {
    await env.DB.prepare(
      `UPDATE aftership_accounts SET enabled = ?, updated_at = datetime('now') WHERE tenant_id = ?`
    ).bind(body.enabled ? 1 : 0, tenantId).run();
    return Response.json({ ok: true });
  }

  if (body.action === 'remove') {
    await env.DB.prepare('DELETE FROM aftership_accounts WHERE tenant_id = ?').bind(tenantId).run();
    await env.KV.delete(`aftership:${tenantId}`);
    return Response.json({ ok: true });
  }

  // Enable / update credentials
  const apiKey = (body.api_key || '').trim();
  if (apiKey) {
    await env.KV.put(`aftership:${tenantId}`, JSON.stringify({
      apiKey,
      webhookSecret: body.webhook_secret || undefined,
    }));
  } else {
    const existing = await env.KV.get(`aftership:${tenantId}`);
    if (!existing) {
      return Response.json({ error: 'An AfterShip API key is required the first time a client is enabled.' }, { status: 400 });
    }
  }

  await env.DB.prepare(
    `INSERT INTO aftership_accounts (tenant_id, enabled, enabled_at, created_at, updated_at)
     VALUES (?, 1, datetime('now'), datetime('now'), datetime('now'))
     ON CONFLICT(tenant_id) DO UPDATE SET enabled = 1, updated_at = datetime('now')`
  ).bind(tenantId).run();

  return Response.json({ ok: true, note: 'Enabled. Only orders fulfilled from now on are pushed.' });
};
