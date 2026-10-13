-- Per-call log for the SpeeDee custom-carrier adapter, feeding the portal's
-- SpeeDee page (like Orders: list + expandable request/response payloads).
-- One row per Logiwa item processed (rate/create/void), plus token/eod/webhook
-- events. Payloads stored redacted (labels stripped) and truncated. Additive.
CREATE TABLE IF NOT EXISTS speedee_call_log (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,             -- token | rate | create | void | eod | webhook
  environment TEXT,                   -- test | production
  shipment_order_code TEXT,
  shipment_order_identifier TEXT,
  speedee_order_id TEXT,
  is_successful INTEGER,              -- 1/0 (null for informational rows)
  duration_ms INTEGER,
  request_json TEXT,                  -- redacted + truncated
  response_json TEXT,                 -- redacted + truncated
  message TEXT,                       -- first error/warning line
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_speedee_log_created ON speedee_call_log(created_at);
CREATE INDEX IF NOT EXISTS idx_speedee_log_code ON speedee_call_log(shipment_order_code);
