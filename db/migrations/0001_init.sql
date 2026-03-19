-- Phase 1: Initial schema

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logiwa_api_url TEXT NOT NULL,
  logiwa_credentials TEXT NOT NULL,   -- encrypted JSON
  callback_url TEXT,                  -- where we push tracking updates
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  label TEXT,                         -- e.g. "production", "staging"
  active INTEGER NOT NULL DEFAULT 1,
  rate_limit INTEGER NOT NULL DEFAULT 60,  -- requests per minute
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  external_order_id TEXT,             -- client's order ID
  logiwa_order_id TEXT,               -- Logiwa's order ID
  status TEXT NOT NULL DEFAULT 'received',  -- received | sent | fulfilled | closed | error
  request_payload_key TEXT,           -- R2 key for raw request
  response_payload_key TEXT,          -- R2 key for raw response
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  request_payload_key TEXT,           -- R2 key for raw payload
  error_message TEXT,
  error_code INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_cache (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_external ON orders(tenant_id, external_order_id);
CREATE INDEX IF NOT EXISTS idx_error_log_unresolved ON error_log(tenant_id, resolved, created_at);
CREATE INDEX IF NOT EXISTS idx_request_log_tenant ON request_log(tenant_id, created_at);
