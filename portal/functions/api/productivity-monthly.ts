interface Env {
  DB: D1Database;
}

// Monthly productivity rollup from productivity_daily (0018; nightly cron +
// Aug-2026 backfill). Returns per-month rows at full dimension grain; the page
// slices client-side exactly like the live view.

// GET /api/productivity-monthly?env=production&months=6
//  or ?env=production&from=2026-10-16&to=2026-11-15 — an explicit day range
//  (billing periods don't have to align to calendar months). Rows are still
//  grouped by month, so a range that spans a month boundary shows each part.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const logiwaEnv = url.searchParams.get('env') === 'sandbox' ? 'sandbox' : 'production';
  const months = Math.min(Math.max(parseInt(url.searchParams.get('months') || '6'), 2), 18);

  const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const fromQ = url.searchParams.get('from');
  const toQ = url.searchParams.get('to');
  const custom = isDay(fromQ) && isDay(toQ) && fromQ <= toQ;

  let sinceDay: string;
  let untilDay: string | null = null;
  if (custom) {
    sinceDay = fromQ as string;
    untilDay = toQ as string;
  } else {
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - (months - 1));
    sinceDay = `${since.toISOString().slice(0, 7)}-01`;
  }

  const sql =
    `SELECT substr(day, 1, 7) AS month, user_name, client, job_type, task_type,
            SUM(pu) AS pu, SUM(eaches) AS eaches, SUM(tasks) AS tasks, SUM(alloc_ms) AS ms
     FROM productivity_daily
     WHERE environment = ? AND day >= ?${untilDay ? ' AND day <= ?' : ''}
     GROUP BY month, user_name, client, job_type, task_type
     ORDER BY month`;
  const stmt = untilDay
    ? env.DB.prepare(sql).bind(logiwaEnv, sinceDay, untilDay)
    : env.DB.prepare(sql).bind(logiwaEnv, sinceDay);
  const { results } = await stmt.all();

  const coverage = (await env.DB.prepare(
    `SELECT MIN(day) AS first_day, MAX(day) AS last_day, COUNT(DISTINCT day) AS days
     FROM productivity_daily WHERE environment = ?`
  ).bind(logiwaEnv).first()) as any;

  return Response.json({
    environment: logiwaEnv,
    months,
    range: custom ? { from: sinceDay, to: untilDay } : null,
    coverage,
    rows: (results || []).map((r: any) => ({
      m: r.month, u: r.user_name, c: r.client, jt: r.job_type, tt: r.task_type,
      pu: r.pu, e: r.eaches, t: r.tasks, ms: r.ms,
    })),
  });
};
