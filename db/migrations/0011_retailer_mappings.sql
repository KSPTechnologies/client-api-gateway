-- Per-tenant retailer mapping: clients send their own retailer/customer
-- numbers in retailerDetails.retailerIdentifier; the gateway swaps in the
-- Logiwa retailer GUID for mapped values (drives retailer packing slips).
-- Unmapped values are moved to retailerCustomerAccountNumber (string field)
-- because Logiwa 422s on non-GUID identifiers. Additive.
CREATE TABLE IF NOT EXISTS retailer_mappings (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  match_value TEXT NOT NULL,        -- the client's number, e.g. 899321
  retailer_uuid TEXT NOT NULL,      -- Logiwa retailer identifier
  retailer_name TEXT,               -- for portal/debug readability
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, match_value)
);
