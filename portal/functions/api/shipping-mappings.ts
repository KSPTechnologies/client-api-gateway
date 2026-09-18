interface Env {
  DB: D1Database;
}

// Shipping-option mapping rules (shipping_option_mappings): per-tenant rewrites
// applied by the Worker before an order reaches Logiwa. A rule matches on the
// order's carrierSetupName (and optionally shippingOptionName, migration 0012)
// and substitutes the configured shippingOptionDetails.

// GET /api/shipping-mappings — list all rules with tenant names
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    `SELECT m.tenant_id, t.name AS tenant_name, m.match_setup_name, m.match_option_name,
            m.replacement, m.enabled, m.created_at
     FROM shipping_option_mappings m
     LEFT JOIN tenants t ON t.id = m.tenant_id
     ORDER BY t.name, m.match_setup_name`
  ).all();

  const rules = (results || []).map((r: any) => {
    let rep: any = {};
    try { rep = JSON.parse(r.replacement); } catch { /* leave empty */ }
    return { ...r, replacement: rep };
  });
  return Response.json(rules);
};

// POST /api/shipping-mappings — create or update a rule (upsert on tenant+setup)
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as {
    tenant_id: string;
    match_setup_name: string;
    match_option_name?: string | null;
    shipping_option_name: string;
    carrier_name: string;
    carrier_setup_name: string;
    unmatched_as_requested: boolean;
    enabled: boolean;
  };

  if (!body.tenant_id || !body.match_setup_name) {
    return Response.json({ error: 'tenant_id and match_setup_name are required' }, { status: 400 });
  }
  if (!body.shipping_option_name || !body.carrier_name || !body.carrier_setup_name) {
    return Response.json({ error: 'All three replacement fields are required' }, { status: 400 });
  }

  const replacement = JSON.stringify({
    shippingOptionName: body.shipping_option_name.trim(),
    carrierName: body.carrier_name.trim(),
    carrierSetupName: body.carrier_setup_name.trim(),
    isSetUnmatchedShippingOptionAsRequested: !!body.unmatched_as_requested,
  });
  const matchOption = body.match_option_name?.trim() || null;

  await env.DB.prepare(
    `INSERT INTO shipping_option_mappings (tenant_id, match_setup_name, match_option_name, replacement, enabled)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, match_setup_name) DO UPDATE SET
       match_option_name = excluded.match_option_name,
       replacement = excluded.replacement,
       enabled = excluded.enabled`
  ).bind(
    body.tenant_id,
    body.match_setup_name.trim(),
    matchOption,
    replacement,
    body.enabled ? 1 : 0
  ).run();

  return Response.json({ ok: true });
};

// DELETE /api/shipping-mappings?tenant_id=..&match_setup_name=..
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id');
  const setupName = url.searchParams.get('match_setup_name');
  if (!tenantId || !setupName) {
    return Response.json({ error: 'tenant_id and match_setup_name are required' }, { status: 400 });
  }
  await env.DB.prepare(
    `DELETE FROM shipping_option_mappings WHERE tenant_id = ? AND match_setup_name = ?`
  ).bind(tenantId, setupName).run();
  return Response.json({ ok: true });
};
