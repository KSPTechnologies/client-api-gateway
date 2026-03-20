interface Env {
  KV: KVNamespace;
}

// GET /api/environment — get current Logiwa environment
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const current = await env.KV.get('logiwa:environment') || 'sandbox';
  return Response.json({ environment: current });
};

// POST /api/environment — toggle Logiwa environment
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json() as { environment: 'sandbox' | 'production' };

  if (body.environment !== 'sandbox' && body.environment !== 'production') {
    return Response.json({ error: 'Must be "sandbox" or "production"' }, { status: 400 });
  }

  await env.KV.put('logiwa:environment', body.environment);

  return Response.json({ environment: body.environment });
};
