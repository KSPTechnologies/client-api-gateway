interface Env {
  KV: KVNamespace;
}

// Productivity data: slim COMPLETED task rows (who, client, job type, task
// type, units, finish time) from Logiwa's warehouse-task report, windowed by
// PlannedStartDateTime. All slicing/rates happen client-side so the page can
// cut by user / client / job type freely.

interface TaskRow {
  executedByDisplayName: string | null;
  clientDisplayName: string | null;
  jobTypeName: string | null;
  warehouseTaskTypeName: string | null;
  warehouseTaskStatusName: string | null;
  warehouseJobCode: string | null;
  toTaskQuantity: number | null;
  fromTaskQuantity: number | null;
  actualFinishDateTime: string | null;
}

async function getToken(apiUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${apiUrl}/v3.1/Authorize/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Logiwa auth failed: ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

// GET /api/productivity?env=production&days=1
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const logiwaEnv = url.searchParams.get('env') === 'sandbox' ? 'sandbox' : 'production';
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '1'), 1), 14);

  const prefix = logiwaEnv === 'production' ? 'logiwa:prod' : 'logiwa:sandbox';
  const apiUrl = await env.KV.get(`${prefix}:api_url`);
  const username = await env.KV.get(`${prefix}:username`);
  const password = await env.KV.get(`${prefix}:password`);
  if (!apiUrl || !username || !password) {
    return Response.json({ error: `Logiwa ${logiwaEnv} credentials not configured in KV` }, { status: 500 });
  }

  const d = (off: number) => new Date(Date.now() + off * 86_400_000).toISOString().split('T')[0];
  const range = `${d(-days)},${d(1)}`;

  try {
    const token = await getToken(apiUrl, username, password);
    const pageUrl = (p: number) =>
      `${apiUrl}/v3.1/Report/WarehouseTask/order-operation/i/${p}/s/200?PlannedStartDateTime.bt=${range}`;
    const getPage = async (p: number): Promise<{ data: TaskRow[]; totalCount: number }> => {
      const res = await fetch(pageUrl(p), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`task report ${res.status}`);
      return (await res.json()) as { data: TaskRow[]; totalCount: number };
    };

    const MAX_PAGES = 15;
    const first = await getPage(0);
    const total = first.totalCount ?? 0;
    const all: TaskRow[] = [...(first.data || [])];
    const pagesNeeded = Math.min(Math.ceil(total / 200), MAX_PAGES);
    if (pagesNeeded > 1) {
      const rest = await Promise.all(Array.from({ length: pagesNeeded - 1 }, (_, i) => getPage(i + 1)));
      for (const b of rest) all.push(...(b.data || []));
    }

    const rows = all
      .filter((t) => t.warehouseTaskStatusName === 'Completed' && t.executedByDisplayName && t.actualFinishDateTime)
      .map((t) => ({
        u: t.executedByDisplayName as string,
        c: t.clientDisplayName || '(no client)',
        jt: t.jobTypeName || '(untyped)',
        tt: t.warehouseTaskTypeName || '?',
        j: t.warehouseJobCode || '',
        q: Number(t.toTaskQuantity ?? t.fromTaskQuantity ?? 1) || 1,
        f: Date.parse(t.actualFinishDateTime as string),
      }))
      .filter((r) => isFinite(r.f));

    return Response.json({
      environment: logiwaEnv,
      days,
      taskRowsInWindow: total,
      taskRowsLoaded: all.length,
      truncated: all.length < total,
      rows,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
};
