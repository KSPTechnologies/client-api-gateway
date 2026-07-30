-- Per-tenant shipping-option rewrite: client systems send their own carrier
-- setup names (often sandbox-era); the gateway swaps in the production config
-- before Logiwa sees it. Only tenants with rows are affected. Additive.
CREATE TABLE IF NOT EXISTS shipping_option_mappings (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  match_setup_name TEXT NOT NULL,       -- matches shippingOptionDetails.carrierSetupName (case-insensitive)
  replacement TEXT NOT NULL,            -- JSON: the shippingOptionDetails object to substitute
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, match_setup_name)
);
