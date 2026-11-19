-- 0020: Finance workload counts (2026-11-19): Orders, Lines, Eaches + time.
-- Companion to productivity_daily (0018), same nightly cron + backfill script.
--
-- Grain: CT day x environment x client x job type.
--   orders / lines: DISTINCT shipmentOrderCode / shipmentOrderLineIdentifier,
--     attributed to the CT day of the order's/line's FIRST completed task in
--     the fetch window (so month sums are true distinct counts; an order
--     worked across two days counts once, on the first day).
--   picked_pu / picked_eaches: fromTaskQuantity / fromTaskUOMQuantity summed
--     over PICKING tasks finished that day only (a unit picked then packed
--     counts once). Hours come from productivity_daily (SUM alloc_ms by the
--     same dims) — not duplicated here.
CREATE TABLE IF NOT EXISTS productivity_daily_work (
  day TEXT NOT NULL,
  environment TEXT NOT NULL,
  client TEXT NOT NULL,
  job_type TEXT NOT NULL,
  orders INTEGER NOT NULL DEFAULT 0,
  lines INTEGER NOT NULL DEFAULT 0,
  picked_pu REAL NOT NULL DEFAULT 0,
  picked_eaches REAL NOT NULL DEFAULT 0,
  tasks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, environment, client, job_type)
);
CREATE INDEX IF NOT EXISTS idx_prod_work_env_day ON productivity_daily_work (environment, day);
