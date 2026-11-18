-- Daily productivity aggregates (feeds the portal Productivity page's monthly
-- view). The live page pulls Logiwa's task report on demand but is capped at a
-- few days of rows; month-to-month needs history, so a nightly cron snapshots
-- each CT day's completed tasks here (and a one-time backfill covers Aug 2026+).
--
-- Grain: one row per (day, env, user, client, job type, task type, pack type).
-- pu = pickable units (task quantity in its pack type; 1 case = 1 grab)
-- eaches = inner UOM quantity (case of 500 counts 500)
-- alloc_ms = the user's gap-capped active time that day, allocated to this row
--            by task share — so ANY monthly slice sums pu/alloc_ms into PU/Hr.
CREATE TABLE IF NOT EXISTS productivity_daily (
  day TEXT NOT NULL,                  -- YYYY-MM-DD, America/Chicago
  environment TEXT NOT NULL,          -- production | sandbox
  user_name TEXT NOT NULL,
  client TEXT NOT NULL,
  job_type TEXT NOT NULL,
  task_type TEXT NOT NULL,
  pack_type TEXT NOT NULL,
  pu REAL NOT NULL DEFAULT 0,
  eaches REAL NOT NULL DEFAULT 0,
  tasks INTEGER NOT NULL DEFAULT 0,
  alloc_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, environment, user_name, client, job_type, task_type, pack_type)
);
CREATE INDEX IF NOT EXISTS idx_prod_daily_month ON productivity_daily(environment, day);
