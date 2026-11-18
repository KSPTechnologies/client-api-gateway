interface Env {
  DB: D1Database;
}

// Monthly productivity rollup from productivity_daily (0018; nightly cron +
// Aug-2026 backfill). Returns per-month rows at full dimension grain; the page
// slices client-side exactly like the live view.

// GET /api/productivity-monthly?env=production&months=6
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const logiwaEnv = url.searchParams.get('env') === 'sandbox' ? 'sandbox' : 'production';
  const months = Math.min(Math.max(parseInt(url.searchParams.get('months') || '6'), 2), 18);

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - (months - 1));
  const sinceDay = `${since.toISOString().slice(0, 7)}-01`;

  const { results } = await env.DB.prepare(
    `SELECT substr(day, 1, 7) AS month, user_name, client, job_type, task_type,
            SUM(pu) AS pu, SUM(eaches) AS eaches, SUM(tasks) AS tasks, SUM(alloc_ms) AS ms
     FROM productivity_daily
     WHERE environment = ? AND day >= ?
     GROUP BY month, user_name, client, job_type, task_type
     ORDER BY month`
  ).bind(logiwaEnv, sinceDay).all();

  const coverage = (await env.DB.prepare(
    `SELECT MIN(day) AS first_day, MAX(day) AS last_day, COUNT(DISTINCT day) AS days
     FROM productivity_daily WHERE environment = ?`
  ).bind(logiwaEnv).first()) as any;

  return Response.json({
    environment: logiwaEnv,
    months,
    coverage,
    rows: (results || []).map((r: any) => ({
      m: r.month, u: r.user_name, c: r.client, jt: r.job_type, tt: r.task_type,
      pu: r.pu, e: r.eaches, t: r.tasks, ms: r.ms,
    })),
  });
};
