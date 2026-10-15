interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

// API Console proxy: forwards an act-as-client request to the Worker's internal
// /admin/console endpoint, authenticated by the shared secret in KV (read
// server-side here — it never reaches the browser). Adds the operator's
// Cloudflare Access email for the audit trail.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = await env.KV.get('console:secret');
  if (!secret) {
    return Response.json({ error: 'console secret not configured (KV console:secret)' }, { status: 500 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const operatorEmail = request.headers.get('Cf-Access-Authenticated-User-Email') || 'unknown';

  const res = await fetch('https://connect.ksp3plhq.com/admin/console', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Console-Secret': secret },
    body: JSON.stringify({ ...body, operatorEmail }),
  });

  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
