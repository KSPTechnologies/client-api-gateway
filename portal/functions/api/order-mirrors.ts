interface Env {
  DB: D1Database;
}

// Logiwa order mirror config (logiwa_order_mirrors, migration 0014): tenants
// whose Logiwa-UI-created orders the gateway imports every 15 min so the
// tracking endpoint works for them. Managed from the portal's Order Mirror page.

// GET /api/order-mirrors
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    `SELECT m.tenant_id, t.name AS tenant_name, t.logiwa_environment, m.enabled,
            m.lookback_days, m.last_run_at, m.last_imported, m.created_at,
            (SELECT COUNT(*) FROM orders o WHERE o.tenant_id = m.tenant_id) AS total_orders
     FROM logiwa_order_mirrors m
     LEFT JOIN tenants t ON t.id = m.tenant_id
     ORDER BY t.name`
  ).all();
  return Response.json(results || []);
};

// POST /api/order-mirrors — create or update (upsert on tenant)
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as {
    tenant_id: string;
    enabled: boolean;
    lookback_days?: number;
  };
  if (!body.tenant_id) {
    return Response.json({ error: 'tenant_id is required' }, { status: 400 });
  }
  const lookback = Math.min(Math.max(Number(body.lookback_days) || 3, 1), 30);

  await env.DB.prepare(
    `INSERT INTO logiwa_order_mirrors (tenant_id, enabled, lookback_days)
     VALUES (?, ?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET enabled = excluded.enabled, lookback_days = excluded.lookback_days`
  ).bind(body.tenant_id, body.enabled ? 1 : 0, lookback).run();

  return Response.json({ ok: true });
};

// DELETE /api/order-mirrors?tenant_id=..
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const tenantId = new URL(request.url).searchParams.get('tenant_id');
  if (!tenantId) return Response.json({ error: 'tenant_id is required' }, { status: 400 });
  await env.DB.prepare(`DELETE FROM logiwa_order_mirrors WHERE tenant_id = ?`).bind(tenantId).run();
  return Response.json({ ok: true });
};
