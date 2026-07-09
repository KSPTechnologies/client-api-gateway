-- SFTP file-drop connector (Gray Tools + future clients).
-- Additive only: new tables + indexes. No existing tables altered.

-- Maps an SFTPGo virtual user to a gateway tenant + config.
CREATE TABLE IF NOT EXISTS sftp_clients (
  sftp_username TEXT PRIMARY KEY,                 -- SFTPGo virtual user (e.g. graytools)
  tenant_id TEXT NOT NULL REFERENCES tenants(id), -- gateway tenant we submit orders as
  environment TEXT NOT NULL DEFAULT 'sandbox',    -- sandbox | production (which Logiwa env)
  r2_prefix TEXT NOT NULL,                        -- e.g. sftp/graytools/
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per file we ingest — idempotency + pipeline/confirmation status + portal visibility.
CREATE TABLE IF NOT EXISTS sftp_files (
  id TEXT PRIMARY KEY,
  sftp_username TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,                 -- current object key (in/ then processed/ or failed/)
  file_name TEXT,
  order_code TEXT,                      -- `code` from the order file
  gateway_order_id TEXT,               -- links to orders(id)
  status TEXT NOT NULL DEFAULT 'received',  -- received | sent | error | confirmed
  confirmation_key TEXT,               -- out/ object key once the confirmation is written
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sftp_files_key ON sftp_files(r2_key);
CREATE INDEX IF NOT EXISTS idx_sftp_files_status ON sftp_files(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_sftp_files_client ON sftp_files(sftp_username, created_at);
CREATE INDEX IF NOT EXISTS idx_sftp_files_order ON sftp_files(gateway_order_id);
