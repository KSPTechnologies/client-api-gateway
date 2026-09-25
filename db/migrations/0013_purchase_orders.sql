-- Purchase orders finally get a D1 home (they previously only left traces in
-- R2 payloads + error_log, so a failed PO was invisible outside the Errors
-- page). The PO create route records every attempt here; the portal's unified
-- Orders view shows them with a 'po' badge. Additive.
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,                 -- gateway PO id (same id used in R2 keys)
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  external_code TEXT,                  -- client's PO code
  logiwa_po_id TEXT,                   -- Logiwa identifier when created
  status TEXT NOT NULL DEFAULT 'sent', -- sent | error
  last_error TEXT,
  environment TEXT,
  request_payload_key TEXT,            -- R2 key for raw request
  response_payload_key TEXT,           -- R2 key for raw response
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_po_tenant_created ON purchase_orders(tenant_id, created_at);
