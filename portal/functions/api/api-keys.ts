interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'cag_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// GET /api/api-keys?tenant_id=xxx — list keys for a tenant
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id');

  let result;
  if (tenantId) {
    result = await env.DB.prepare(
      'SELECT id, tenant_id, label, active, rate_limit, last_used_at, created_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC'
    ).bind(tenantId).all();
  } else {
    result = await env.DB.prepare(
      'SELECT ak.id, ak.tenant_id, t.name as tenant_name, ak.label, ak.active, ak.rate_limit, ak.last_used_at, ak.created_at FROM api_keys ak JOIN tenants t ON ak.tenant_id = t.id ORDER BY ak.created_at DESC'
    ).all();
  }

  return Response.json(result.results);
};

// POST /api/api-keys — generate a new key for a tenant
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json() as {
    tenant_id: string;
    label?: string;
    rate_limit?: number;
  };

  if (!body.tenant_id) {
    return Response.json({ error: 'Missing required field: tenant_id' }, { status: 400 });
  }

  // Verify tenant exists
  const tenant = await env.DB.prepare('SELECT id, name FROM tenants WHERE id = ?').bind(body.tenant_id).first();
  if (!tenant) {
    return Response.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const rawKey = generateApiKey();
  const keyHash = await hashKey(rawKey);
  const id = crypto.randomUUID();
  const rateLimit = body.rate_limit || 60;

  // Store hash in D1
  await env.DB.prepare(
    `INSERT INTO api_keys (id, key_hash, tenant_id, label, active, rate_limit, created_at)
     VALUES (?, ?, ?, ?, 1, ?, datetime('now'))`
  )
    .bind(id, keyHash, body.tenant_id, body.label || null, rateLimit)
    .run();

  // Store lookup in KV for fast auth
  await env.KV.put(`apikey:${keyHash}`, JSON.stringify({
    tenantId: body.tenant_id,
    tenantName: tenant.name,
    rateLimit,
    active: true,
  }));

  // Return the raw key ONCE — it can never be retrieved again
  return Response.json({
    id,
    key: rawKey,
    tenant_id: body.tenant_id,
    label: body.label || null,
    message: 'Save this key now — it cannot be retrieved again.',
  }, { status: 201 });
};
