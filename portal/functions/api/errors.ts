interface Env {
  DB: D1Database;
}

// GET /api/errors?resolved=0&tenant_id=xxx
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id');
  const resolved = url.searchParams.get('resolved') || '0';
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  let query = `SELECT e.*, t.name as tenant_name FROM error_log e JOIN tenants t ON e.tenant_id = t.id WHERE e.resolved = ?`;
  const params: unknown[] = [parseInt(resolved)];

  if (tenantId) {
    query += ' AND e.tenant_id = ?';
    params.push(tenantId);
  }

  query += ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const result = await env.DB.prepare(query).bind(...params).all();

  return Response.json(result.results);
};

// POST /api/errors — mark as resolved or retry
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json() as {
    action: 'resolve' | 'retry';
    ids: number[];
  };

  if (!body.action || !body.ids?.length) {
    return Response.json({ error: 'Missing action or ids' }, { status: 400 });
  }

  if (body.action === 'resolve') {
    const placeholders = body.ids.map(() => '?').join(',');
    await env.DB.prepare(
      `UPDATE error_log SET resolved = 1 WHERE id IN (${placeholders})`
    ).bind(...body.ids).run();

    return Response.json({ resolved: body.ids.length });
  }

  if (body.action === 'retry') {
    // TODO: Phase 4 — push these back through the queue
    return Response.json({ message: 'Retry queued', ids: body.ids });
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 });
};
