interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

// Floor Jobs: live view of Logiwa warehouse jobs grouped by JOB TYPE (the
// categories), each drillable to its jobs and then to tasks/orders. Source =
// /v3.1/Report/WarehouseTask/order-operation, windowed by PlannedStartDateTime
// to keep row volume sane (prod has ~100k task rows all-time).

interface TaskRow {
  warehouseJobCode: string | null;
  warehouseJobStatusName: string | null;
  jobTypeName: string | null;
  clientDisplayName: string | null;
  warehouseTaskTypeName: string | null;
  warehouseTaskStatusName: string | null;
  shipmentOrderCode: string | null;
  shipmentOrderIdentifier: string | null;
  productSku: string | null;
  assigneeName: string | null;
  assignedDisplayName: string | null;
  plannedStartDateTime: string | null;
  priority: number | null;
  waveNo: string | null;
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

// GET /api/floor-jobs?env=production&days=2[&jobCode=Job1234567]
// jobCode bypasses the date window and pulls that job directly.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const logiwaEnv = url.searchParams.get('env') === 'sandbox' ? 'sandbox' : 'production';
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '2'), 1), 14);
  const jobCode = (url.searchParams.get('jobCode') || '').trim();

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
    const rows: TaskRow[] = [];
    let total = 0;
    const filter = jobCode
      ? `JobCode.eq=${encodeURIComponent(jobCode)}`
      : `PlannedStartDateTime.bt=${range}`;
    for (let page = 0; page < 6; page++) { // cap: 1200 task rows per load
      const res = await fetch(
        `${apiUrl}/v3.1/Report/WarehouseTask/order-operation/i/${page}/s/200?${filter}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`task report ${res.status}`);
      const body = (await res.json()) as { data: TaskRow[]; totalCount: number };
      total = body.totalCount ?? total;
      rows.push(...(body.data || []));
      if ((body.data || []).length < 200) break;
    }

    // jobCode -> aggregate
    interface JobAgg {
      jobCode: string; jobStatus: string; jobType: string; client: string;
      pending: number; completed: number; otherStatus: Record<string, number>;
      taskTypes: Record<string, number>; orders: Map<string, string | null>; assignees: Set<string>;
      earliestStart: string | null; waves: Set<string>;
    }
    const jobs = new Map<string, JobAgg>();
    for (const t of rows) {
      const code = t.warehouseJobCode || '(no job)';
      let j = jobs.get(code);
      if (!j) {
        j = {
          jobCode: code, jobStatus: t.warehouseJobStatusName || '?',
          jobType: t.jobTypeName || '(untyped)', client: t.clientDisplayName || '',
          pending: 0, completed: 0, otherStatus: {}, taskTypes: {}, orders: new Map(),
          assignees: new Set(), earliestStart: null, waves: new Set(),
        };
        jobs.set(code, j);
      }
      const st = (t.warehouseTaskStatusName || '?');
      if (st === 'Pending') j.pending++;
      else if (st === 'Completed') j.completed++;
      else j.otherStatus[st] = (j.otherStatus[st] || 0) + 1;
      const tt = t.warehouseTaskTypeName || '?';
      j.taskTypes[tt] = (j.taskTypes[tt] || 0) + 1;
      if (t.shipmentOrderCode) {
        // UUID (shipmentOrderIdentifier) is what external systems like Locus
        // receive — keep it alongside the code for cross-referencing.
        if (!j.orders.has(t.shipmentOrderCode) || t.shipmentOrderIdentifier) {
          j.orders.set(t.shipmentOrderCode, t.shipmentOrderIdentifier || j.orders.get(t.shipmentOrderCode) || null);
        }
      }
      const who = t.assigneeName || t.assignedDisplayName;
      if (who) j.assignees.add(who);
      if (t.waveNo) j.waves.add(t.waveNo);
      if (t.plannedStartDateTime && (!j.earliestStart || t.plannedStartDateTime < j.earliestStart)) {
        j.earliestStart = t.plannedStartDateTime;
      }
    }

    // jobType -> category
    const categories: Record<string, { jobType: string; jobCount: number; pendingTasks: number; completedTasks: number; pendingJobs: number; jobs: unknown[] }> = {};
    for (const j of jobs.values()) {
      const c = (categories[j.jobType] = categories[j.jobType] || {
        jobType: j.jobType, jobCount: 0, pendingTasks: 0, completedTasks: 0, pendingJobs: 0, jobs: [],
      });
      c.jobCount++;
      c.pendingTasks += j.pending;
      c.completedTasks += j.completed;
      if (j.pending > 0) c.pendingJobs++;
      c.jobs.push({
        jobCode: j.jobCode, jobStatus: j.jobStatus, client: j.client,
        pending: j.pending, completed: j.completed, otherStatus: j.otherStatus,
        taskTypes: j.taskTypes,
        orders: [...j.orders.entries()].map(([code, uuid]) => ({ code, uuid })),
        assignees: [...j.assignees],
        earliestStart: j.earliestStart, waves: [...j.waves],
      });
    }
    for (const c of Object.values(categories)) {
      (c.jobs as any[]).sort((a, b) => (b.pending - a.pending) || String(a.jobCode).localeCompare(String(b.jobCode)));
    }

    return Response.json({
      environment: logiwaEnv,
      days,
      taskRowsInWindow: total,
      taskRowsLoaded: rows.length,
      truncated: rows.length < total,
      categories: Object.values(categories).sort((a, b) => b.pendingTasks - a.pendingTasks || b.jobCount - a.jobCount),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
};
