interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

const ENDPOINT_TYPES = [
  { type: 'create_order', label: 'Create Order', method: 'POST', path: '/v1/orders' },
  { type: 'get_order', label: 'Get Order Status', method: 'GET', path: '/v1/orders/:id' },
  { type: 'tracking', label: 'Get Tracking', method: 'GET', path: '/v1/orders/:id/tracking' },
  { type: 'inventory', label: 'Query Inventory', method: 'POST', path: '/v1/inventory/query' },
  { type: 'create_po', label: 'Create Purchase Order', method: 'POST', path: '/v1/purchase-orders' },
  { type: 'webhooks', label: 'Webhook Subscriptions', method: 'POST', path: '/v1/webhooks' },
];

// GET /api/tenants — list all tenants with key counts and enabled endpoints
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const tenants = await env.DB.prepare(
    `SELECT t.id, t.name, t.base_url, t.callback_url, t.active, t.created_at, t.updated_at,
       (SELECT COUNT(*) FROM api_keys ak WHERE ak.tenant_id = t.id AND ak.active = 1) as active_keys
     FROM tenants t ORDER BY t.created_at DESC`
  ).all();

  // Get endpoints for each tenant
  const endpoints = await env.DB.prepare(
    'SELECT tenant_id, endpoint_type, enabled, custom_path FROM tenant_endpoints'
  ).all();

  const endpointMap = new Map<string, any[]>();
  for (const ep of endpoints.results) {
    const tid = ep.tenant_id as string;
    if (!endpointMap.has(tid)) endpointMap.set(tid, []);
    endpointMap.get(tid)!.push(ep);
  }

  const result = tenants.results.map((t: any) => ({
    ...t,
    endpoints: endpointMap.get(t.id) || [],
  }));

  return Response.json(result);
};

// POST /api/tenants — create a tenant with endpoint selections
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json() as {
    name: string;
    base_url?: string;
    callback_url?: string;
    endpoints?: string[];
  };

  if (!body.name) {
    return Response.json({ error: 'Missing required field: name' }, { status: 400 });
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO tenants (id, name, base_url, logiwa_api_url, logiwa_credentials, callback_url, active, created_at, updated_at)
     VALUES (?, ?, ?, '', '{}', ?, 1, datetime('now'), datetime('now'))`
  )
    .bind(id, body.name, body.base_url || null, body.callback_url || null)
    .run();

  // Insert selected endpoints
  const selectedEndpoints = body.endpoints || [];
  for (const epType of selectedEndpoints) {
    await env.DB.prepare(
      `INSERT INTO tenant_endpoints (tenant_id, endpoint_type, enabled, created_at)
       VALUES (?, ?, 1, datetime('now'))`
    )
      .bind(id, epType)
      .run();
  }

  // Build generated endpoint list for response
  const generatedEndpoints = selectedEndpoints.map((epType) => {
    const def = ENDPOINT_TYPES.find((e) => e.type === epType);
    return def ? { type: epType, method: def.method, path: def.path, label: def.label } : null;
  }).filter(Boolean);

  return Response.json({ id, name: body.name, endpoints: generatedEndpoints }, { status: 201 });
};
