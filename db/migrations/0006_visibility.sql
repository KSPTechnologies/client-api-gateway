-- Visibility + packType resolution support. Additive only.

-- Heartbeat: one row per cron job, updated every run, so the portal can show
-- "is it running" at a glance.
CREATE TABLE IF NOT EXISTS cron_runs (
  cron TEXT PRIMARY KEY,              -- friendly name: tracking-sync | inventory-refresh | sftp-connector
  last_run_at TEXT,
  last_status TEXT,                   -- ok | error
  detail TEXT
);

-- Cache of each product's default pack type (uomPackTypeName), used to fill in
-- order lines that omit packType so Logiwa gets the product's own default.
CREATE TABLE IF NOT EXISTS product_packtype_cache (
  tenant_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  pack_type TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, sku)
);
