-- Zoho connector (Fred / Rescue ID) — per-tenant Zoho CRM integration.
-- Additive only: new tables + indexes. No existing tables are altered.
-- OAuth secrets/tokens are NOT stored here — they live in KV under
-- zoho:creds:<tenant_id>, mirroring how Logiwa credentials are handled.

-- Per-tenant Zoho configuration (non-secret).
CREATE TABLE IF NOT EXISTS zoho_accounts (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  api_domain TEXT NOT NULL DEFAULT 'https://www.zohoapis.com',        -- data-center API base (.com/.eu/.in/...)
  accounts_domain TEXT NOT NULL DEFAULT 'https://accounts.zoho.com',  -- OAuth token endpoint base
  orders_module TEXT NOT NULL DEFAULT 'Sales_Orders',                 -- Zoho module holding orders
  field_map TEXT,                     -- JSON: Zoho field -> gateway order field (inbound)
  writeback_config TEXT,              -- JSON: where to write status/tracking back (outbound)
  inbound_enabled INTEGER NOT NULL DEFAULT 1,
  writeback_enabled INTEGER NOT NULL DEFAULT 1,
  poll_enabled INTEGER NOT NULL DEFAULT 1,
  last_poll_at TEXT,                  -- daily reconciliation poll: last run time
  poll_cursor TEXT,                   -- daily reconciliation poll: modified-since / page cursor
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per Zoho order we process — idempotency, pipeline + writeback status,
-- and the data the portal reads to "watch" an order flow through end to end.
CREATE TABLE IF NOT EXISTS zoho_sync (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  zoho_record_id TEXT NOT NULL,       -- Zoho Sales Order record id (dedup key + writeback target)
  order_code TEXT,                    -- the `code` sent to the gateway / Logiwa
  gateway_order_id TEXT,              -- links to orders(id)
  source TEXT NOT NULL DEFAULT 'webhook',            -- webhook | poll
  inbound_status TEXT NOT NULL DEFAULT 'received',   -- received | sent | error
  writeback_status TEXT NOT NULL DEFAULT 'pending',  -- pending | written | error | skipped
  writeback_last_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Idempotency: never ingest the same Zoho record twice (webhook + poll dedup).
CREATE UNIQUE INDEX IF NOT EXISTS idx_zoho_sync_record ON zoho_sync(tenant_id, zoho_record_id);
CREATE INDEX IF NOT EXISTS idx_zoho_sync_code ON zoho_sync(tenant_id, order_code);
CREATE INDEX IF NOT EXISTS idx_zoho_sync_writeback ON zoho_sync(writeback_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_zoho_sync_tenant ON zoho_sync(tenant_id, created_at);
