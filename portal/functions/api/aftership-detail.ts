interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

// GET /api/aftership-detail?id=<push id>
// Per-push drill-down: stored request payload (secret masked at write time),
// response meta, and a best-effort LIVE status lookup from AfterShip.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const push = (await env.DB.prepare(
    `SELECT p.*, t.name as tenant_name, o.external_order_id as order_code
     FROM aftership_pushes p
     LEFT JOIN tenants t ON p.tenant_id = t.id
     LEFT JOIN orders o ON o.id = p.order_id
     WHERE p.id = ?`
  ).bind(id).first()) as any;
  if (!push) return Response.json({ error: 'push not found' }, { status: 404 });

  // Live status from AfterShip (best effort — page still renders without it).
  let live: any = null;
  try {
    if (push.aftership_id) {
      const creds = (await env.KV.get(`aftership:${push.tenant_id}`, 'json')) as { apiKey?: string } | null;
      if (creds?.apiKey) {
        const res = await fetch(`https://api.aftership.com/tracking/2026-07/trackings/${encodeURIComponent(push.aftership_id)}`, {
          headers: { 'as-api-key': creds.apiKey },
        });
        if (res.ok) {
          const j: any = await res.json();
          const t = j?.data?.tracking ?? j?.data;
          if (t) {
            live = {
              tag: t.tag,
              subtag_message: t.subtag_message || null,
              expected_delivery: t.expected_delivery || null,
              courier_tracking_link: t.courier_tracking_link || null,
              checkpoints: (t.checkpoints || []).slice(-4).reverse().map((c: any) => ({
                time: c.checkpoint_time || c.created_at,
                message: c.message,
                location: c.location || [c.city, c.state].filter(Boolean).join(', ') || null,
              })),
            };
          }
        }
      }
    }
  } catch { /* live status is a bonus, not a requirement */ }

  let requestPayload: unknown = null;
  try { requestPayload = push.request_payload ? JSON.parse(push.request_payload) : null; } catch { requestPayload = push.request_payload; }
  let responseMeta: unknown = null;
  try { responseMeta = push.response_meta ? JSON.parse(push.response_meta) : null; } catch { responseMeta = push.response_meta; }

  return Response.json({
    push: {
      id: push.id,
      tenant_name: push.tenant_name,
      order_code: push.order_code,
      tracking_number: push.tracking_number,
      aftership_id: push.aftership_id,
      status: push.status,
      last_error: push.last_error,
      created_at: push.created_at,
      updated_at: push.updated_at,
    },
    requestPayload,
    responseMeta,
    live,
  });
};
