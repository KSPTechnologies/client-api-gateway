-- SpeeDee (ShipIt) custom-carrier adapter (routes /carriers/speedee/*).
-- Logiwa's Custom Carrier integration calls the gateway; the gateway calls
-- SpeeDee's ShipIt API. Additive: new tables, new routes, own auth system
-- (gateway-issued key/secret -> bearer token), separate from tenant API keys.

-- Gateway-issued credentials pasted into Logiwa's "Create Shipping Integration"
-- Connection screen (API Key / API Secret). Secret stored as SHA-256 hash.
CREATE TABLE IF NOT EXISTS carrier_api_clients (
  id TEXT PRIMARY KEY,
  carrier TEXT NOT NULL,              -- 'speedee'
  api_key TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,          -- sha256(secret)
  label TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per Logiwa shipment order we created in SpeeDee. Drives create
-- idempotency, void resolution, and the EOD manifest.
CREATE TABLE IF NOT EXISTS speedee_orders (
  id TEXT PRIMARY KEY,
  shipment_order_identifier TEXT NOT NULL UNIQUE,  -- Logiwa's GUID (idempotency key)
  shipment_order_code TEXT,
  speedee_order_id TEXT,              -- e.g. SD3041 (externalReference)
  environment TEXT NOT NULL,          -- 'test' | 'production'
  status TEXT NOT NULL DEFAULT 'CREATED',  -- CREATED | VOIDED | FAILED
  master_tracking_number TEXT,
  packages TEXT,                      -- JSON [{sequence, trackingNumber, labelKey}]
  charges TEXT,                       -- JSON SpeeDee charges[] for rate detail
  response_json TEXT,                 -- stored Logiwa-shaped create response (idempotent replay)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_speedee_orders_code ON speedee_orders(shipment_order_code);
CREATE INDEX IF NOT EXISTS idx_speedee_orders_tracking ON speedee_orders(master_tracking_number);
CREATE INDEX IF NOT EXISTS idx_speedee_orders_day ON speedee_orders(environment, created_at);
