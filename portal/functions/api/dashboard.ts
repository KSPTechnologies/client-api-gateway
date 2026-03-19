interface Env {
  DB: D1Database;
}

// GET /api/dashboard — aggregated stats for the dashboard
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const [tenants, orders, errors, recentRequests] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM tenants WHERE active = 1').first(),
    env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as received,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'fulfilled' THEN 1 ELSE 0 END) as fulfilled,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error
      FROM orders
    `).first(),
    env.DB.prepare('SELECT COUNT(*) as unresolved FROM error_log WHERE resolved = 0').first(),
    env.DB.prepare(`
      SELECT tenant_id, method, path, status_code, error_message, created_at
      FROM request_log ORDER BY created_at DESC LIMIT 20
    `).all(),
  ]);

  return Response.json({
    tenants: (tenants as { count: number })?.count || 0,
    orders: orders || { total: 0, received: 0, sent: 0, fulfilled: 0, closed: 0, error: 0 },
    unresolvedErrors: (errors as { unresolved: number })?.unresolved || 0,
    recentRequests: recentRequests.results,
  });
};
