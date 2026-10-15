interface Env {
  KV: KVNamespace;
}

// Floor Jobs drill-down helper: resolve live Logiwa order STATUS (Ready to
// Pick / Ready to Pack / Ready to Ship / Shipped ...) for a job's orders by
// their UUIDs. Called lazily when a job row is expanded (one Identifier.eq
// lookup per order, capped).

async function getToken(apiUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${apiUrl}/v3.1/Authorize/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Logiwa auth failed: ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

// GET /api/floor-job-orders?env=production&uuids=a,b,c   (max 15)
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const logiwaEnv = url.searchParams.get('env') === 'sandbox' ? 'sandbox' : 'production';
  const uuids = (url.searchParams.get('uuids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 15);
  if (uuids.length === 0) return Response.json({ statuses: {} });

  const prefix = logiwaEnv === 'production' ? 'logiwa:prod' : 'logiwa:sandbox';
  const apiUrl = await env.KV.get(`${prefix}:api_url`);
  const username = await env.KV.get(`${prefix}:username`);
  const password = await env.KV.get(`${prefix}:password`);
  if (!apiUrl || !username || !password) {
    return Response.json({ error: `Logiwa ${logiwaEnv} credentials not configured` }, { status: 500 });
  }

  try {
    const token = await getToken(apiUrl, username, password);
    const statuses: Record<string, string> = {};
    await Promise.all(uuids.map(async (u) => {
      try {
        const res = await fetch(`${apiUrl}/v3.1/ShipmentOrder/list/i/0/s/1?Identifier.eq=${encodeURIComponent(u)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = (await res.json()) as { data?: Array<{ shipmentOrderStatusName?: string }> };
        statuses[u] = body?.data?.[0]?.shipmentOrderStatusName || '?';
      } catch {
        statuses[u] = '?';
      }
    }));
    return Response.json({ statuses });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
};
