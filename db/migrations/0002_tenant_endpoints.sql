-- Phase 5: Endpoint configuration per tenant

CREATE TABLE IF NOT EXISTS tenant_endpoints (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  endpoint_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  custom_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, endpoint_type)
);

-- Also add base_url column to tenants
ALTER TABLE tenants ADD COLUMN base_url TEXT;
