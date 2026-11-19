import { Env } from '../index';
import { getLogiwaCredentials, logiwaFetch } from './logiwa';

/**
 * Nightly productivity aggregation (productivity_daily, migration 0018).
 * Re-aggregates the previous two America/Chicago days (idempotent: delete +
 * insert per day) from Logiwa's warehouse-task report so the portal's monthly
 * productivity view reads local D1 instead of hammering Logiwa.
 *
 * Methodology mirrors the live Productivity page exactly:
 * - pu = fromTaskQuantity (quantity in the task's pack type; 1 case = 1 grab)
 * - eaches = fromTaskUOMQuantity
 * - active time = per user per day, gaps between consecutive completions
 *   capped at 5 minutes, 60s credit for the first task; allocated to each
 *   aggregate row by task share (alloc_ms) so any slice can form PU/Hr.
 * ADDITIVE: new file, own cron, production environment only.
 */

const GAP_CAP_MS = 5 * 60 * 1000;
const FIRST_TASK_MS = 60_000;

const ctDay = (ms: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));

interface TaskRow {
  executedByDisplayName: string | null;
  clientDisplayName: string | null;
  jobTypeName: string | null;
  warehouseTaskTypeName: string | null;
  warehouseTaskStatusName: string | null;
  fromPackTypeName: string | null;
  fromTaskQuantity: number | null;
  toTaskQuantity: number | null;
  fromTaskUOMQuantity: number | null;
  actualFinishDateTime: string | null;
  shipmentOrderCode: string | null;
  shipmentOrderLineIdentifier: string | null;
}

export async function aggregateProductivity(env: Env): Promise<void> {
  const creds = getLogiwaCredentials(env, 'production');
  if (!creds) throw new Error('production Logiwa credentials not configured');

  // Target: the two most recent COMPLETE CT days.
  const now = Date.now();
  const targets = [ctDay(now - 86_400_000), ctDay(now - 2 * 86_400_000)];

  // Fetch window: planned-start from 4 days back through tomorrow (a task can
  // finish on a later day than it was planned).
  const d = (off: number) => new Date(now + off * 86_400_000).toISOString().split('T')[0];
  const range = `${d(-4)},${d(1)}`;

  const rows: TaskRow[] = [];
  for (let page = 0; page < 40; page++) {
    const res = await logiwaFetch(
      creds, 'GET',
      `/v3.1/Report/WarehouseTask/order-operation/i/${page}/s/200?PlannedStartDateTime.bt=${range}`
    );
    const data: TaskRow[] = res?.data || [];
    rows.push(...data);
    if (data.length < 200) break;
    if (page === 39) console.log('[prodagg] WARNING: 40-page cap hit — window truncated');
  }

  for (const day of targets) {
    const n = await aggregateDayRows(env, 'production', day, rows);
    console.log(`[prodagg] ${day}: ${n} aggregate rows`);
  }
}

/** Shared day-aggregation: filters rows to the CT day, computes aggregates,
 *  and idempotently replaces that day's rows in D1. Returns rows written. */
export async function aggregateDayRows(
  env: Env, environment: string, day: string, allRows: TaskRow[]
): Promise<number> {
  // All completed rows in the WINDOW (first-touch attribution for orders/lines
  // needs neighboring days), then the target-day subset for everything else.
  const windowDone = allRows
    .filter((t) => t.warehouseTaskStatusName === 'Completed' && t.executedByDisplayName && t.actualFinishDateTime)
    .map((t) => ({
      u: t.executedByDisplayName as string,
      c: t.clientDisplayName || '(no client)',
      jt: t.jobTypeName || '(untyped)',
      tt: t.warehouseTaskTypeName || '?',
      pk: t.fromPackTypeName || 'Unit',
      p: Number(t.fromTaskQuantity ?? t.toTaskQuantity ?? 1) || 1,
      e: Number(t.fromTaskUOMQuantity ?? t.fromTaskQuantity ?? 1) || 1,
      f: Date.parse(t.actualFinishDateTime as string),
      oc: t.shipmentOrderCode || null,
      ln: t.shipmentOrderLineIdentifier || null,
    }))
    .filter((r) => isFinite(r.f));
  const done = windowDone.filter((r) => ctDay(r.f) === day);

  // Per-user gap-capped active time for the day.
  const userFinishes = new Map<string, number[]>();
  for (const r of done) {
    if (!userFinishes.has(r.u)) userFinishes.set(r.u, []);
    userFinishes.get(r.u)!.push(r.f);
  }
  const userActiveMs = new Map<string, number>();
  const userTasks = new Map<string, number>();
  for (const [u, fs] of userFinishes) {
    const s = fs.sort((a, b) => a - b);
    let ms = FIRST_TASK_MS;
    for (let i = 1; i < s.length; i++) ms += Math.min(s[i] - s[i - 1], GAP_CAP_MS);
    userActiveMs.set(u, ms);
    userTasks.set(u, fs.length);
  }

  // Aggregate rows with proportional active-time allocation.
  const agg = new Map<string, { u: string; c: string; jt: string; tt: string; pk: string; pu: number; ea: number; tasks: number }>();
  for (const r of done) {
    const key = [r.u, r.c, r.jt, r.tt, r.pk].join('\u0001');
    let a = agg.get(key);
    if (!a) { a = { u: r.u, c: r.c, jt: r.jt, tt: r.tt, pk: r.pk, pu: 0, ea: 0, tasks: 0 }; agg.set(key, a); }
    a.pu += r.p; a.ea += r.e; a.tasks++;
  }

  await env.DB.prepare(`DELETE FROM productivity_daily WHERE day = ? AND environment = ?`)
    .bind(day, environment).run();

  const entries = [...agg.values()];
  for (let i = 0; i < entries.length; i += 20) {
    const chunk = entries.slice(i, i + 20);
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const binds: unknown[] = [];
    for (const a of chunk) {
      const allocMs = Math.round((userActiveMs.get(a.u) || 0) * (a.tasks / (userTasks.get(a.u) || 1)));
      binds.push(day, environment, a.u, a.c, a.jt, a.tt, a.pk, a.pu, a.ea, a.tasks, allocMs);
    }
    await env.DB.prepare(
      `INSERT INTO productivity_daily (day, environment, user_name, client, job_type, task_type, pack_type, pu, eaches, tasks, alloc_ms)
       VALUES ${placeholders}`
    ).bind(...binds).run();
  }

  // ---- Finance workload counts (productivity_daily_work, 0020) ----
  const workEntries = buildWorkRows(day, windowDone);
  await env.DB.prepare(`DELETE FROM productivity_daily_work WHERE day = ? AND environment = ?`)
    .bind(day, environment).run();
  for (let i = 0; i < workEntries.length; i += 20) {
    const chunk = workEntries.slice(i, i + 20);
    const placeholders2 = chunk.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
    const binds2: unknown[] = [];
    for (const w of chunk) binds2.push(day, environment, w.c, w.jt, w.orders, w.lines, w.pu, w.eaches, w.tasks);
    await env.DB.prepare(
      `INSERT INTO productivity_daily_work (day, environment, client, job_type, orders, lines, picked_pu, picked_eaches, tasks)
       VALUES ${placeholders2}`
    ).bind(...binds2).run();
  }
  return entries.length;
}

interface DoneRow { u: string; c: string; jt: string; tt: string; pk: string; p: number; e: number; f: number; oc: string | null; ln: string | null; }

/** Orders/Lines (distinct, first-touch day attribution) + picked PU/eaches per
 *  (client, jobType) for one CT day. Exported so the backfill script's logic
 *  stays verifiable against the same math. */
export function buildWorkRows(day: string, windowDone: DoneRow[]): Array<{ c: string; jt: string; orders: number; lines: number; pu: number; eaches: number; tasks: number }> {
  // First completed task per order / per line across the whole window; the
  // order (or line) counts once, on that first task's CT day, into that first
  // task's (client, jobType) cell — so sums across days/job types stay true
  // distinct counts.
  const firstOf = (idOf: (r: DoneRow) => string | null) => {
    const m = new Map<string, DoneRow>();
    for (const r of windowDone) {
      const id = idOf(r);
      if (!id) continue;
      const cur = m.get(id);
      if (!cur || r.f < cur.f) m.set(id, r);
    }
    return m;
  };
  const firstOrderTask = firstOf((r) => r.oc);
  const firstLineTask = firstOf((r) => r.ln);

  const cells = new Map<string, { c: string; jt: string; orders: number; lines: number; pu: number; eaches: number; tasks: number }>();
  const cell = (c: string, jt: string) => {
    const k = `${c}\u0001${jt}`;
    let v = cells.get(k);
    if (!v) { v = { c, jt, orders: 0, lines: 0, pu: 0, eaches: 0, tasks: 0 }; cells.set(k, v); }
    return v;
  };

  for (const r of firstOrderTask.values()) if (ctDay(r.f) === day) cell(r.c, r.jt).orders++;
  for (const r of firstLineTask.values()) if (ctDay(r.f) === day) cell(r.c, r.jt).lines++;
  for (const r of windowDone) {
    if (ctDay(r.f) !== day) continue;
    const v = cell(r.c, r.jt);
    v.tasks++;
    if (/pick/i.test(r.tt)) { v.pu += r.p; v.eaches += r.e; } // picked once, not re-counted at packing
  }
  return [...cells.values()];
}
