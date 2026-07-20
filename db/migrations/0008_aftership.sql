-- AfterShip connector (Pivot Health + future tenants). Additive only.
-- API key + webhook secret live in KV (aftership:<tenant_id>), never in D1.

CREATE TABLE IF NOT EXISTS aftership_accounts (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  enabled_at TEXT NOT NULL DEFAULT (datetime('now')),  -- only orders fulfilled after this get pushed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per order+tracking number pushed (or attempted) to AfterShip.
CREATE TABLE IF NOT EXISTS aftership_pushes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  aftership_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | pushed | error | skipped
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_aftership_pushes_unique ON aftership_pushes(order_id, tracking_number);
CREATE INDEX IF NOT EXISTS idx_aftership_pushes_status ON aftership_pushes(status, updated_at);
