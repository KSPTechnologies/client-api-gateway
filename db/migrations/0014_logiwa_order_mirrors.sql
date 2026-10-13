-- Logiwa order mirror: for clients whose orders are created directly in the
-- Logiwa UI (not through the gateway), a cron imports their recent Logiwa
-- orders into the orders table so the existing tracking-sync + tracking
-- endpoint work for them unchanged. Table empty = feature inert. Additive.
-- First client: Ready Credit Corp (tracking-only API access).
CREATE TABLE IF NOT EXISTS logiwa_order_mirrors (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  lookback_days INTEGER NOT NULL DEFAULT 3,   -- how far back each pass lists
  last_run_at TEXT,
  last_imported INTEGER NOT NULL DEFAULT 0,   -- orders imported on last pass
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
