-- Audit log for the portal API Console ("act as client"): who ran what call
-- against which tenant. The calls themselves execute through the normal route
-- handlers, so orders/POs created this way are real records. Additive.
CREATE TABLE IF NOT EXISTS console_calls (
  id TEXT PRIMARY KEY,
  operator_email TEXT,                -- from Cloudflare Access, via the portal
  tenant_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER,
  environment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_console_calls_created ON console_calls(created_at);
