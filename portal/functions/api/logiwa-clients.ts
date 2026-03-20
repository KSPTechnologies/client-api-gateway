interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

interface LogiwaClient {
  identifier: string;
  displayName: string;
}

async function getLogiwaToken(apiUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${apiUrl}/v3.1/Authorize/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = await res.json() as { token: string };
  return data.token;
}

async function fetchClients(apiUrl: string, token: string): Promise<LogiwaClient[]> {
  const res = await fetch(`${apiUrl}/v3.1/Client/list/i/0/s/100`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return [];
  const data = await res.json() as { data: Array<{ identifier: string; displayName: string; officialIdentity: string }> };
  return (data.data || []).map((c) => ({
    identifier: c.identifier,
    displayName: c.displayName || c.officialIdentity || c.identifier,
  }));
}

// GET /api/logiwa-clients?env=sandbox|production
// Fetches live client list from Logiwa API
// Creds are read from KV (set via portal settings or wrangler secrets)
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const logiwaEnv = url.searchParams.get('env') || 'sandbox';

  // Read Logiwa creds from KV
  const prefix = logiwaEnv === 'production' ? 'logiwa:prod' : 'logiwa:sandbox';
  const apiUrl = await env.KV.get(`${prefix}:api_url`);
  const username = await env.KV.get(`${prefix}:username`);
  const password = await env.KV.get(`${prefix}:password`);

  if (!apiUrl || !username || !password) {
    return Response.json({
      error: `Logiwa ${logiwaEnv} credentials not configured. Set them in KV.`,
      clients: [],
    }, { status: 200 });
  }

  try {
    const token = await getLogiwaToken(apiUrl, username, password);
    const clients = await fetchClients(apiUrl, token);
    return Response.json({ environment: logiwaEnv, clients });
  } catch (err) {
    return Response.json({
      error: `Failed to fetch from Logiwa ${logiwaEnv}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      clients: [],
    });
  }
};
