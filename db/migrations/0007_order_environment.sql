-- Track which Logiwa environment each order was created in, so tracking-sync
-- checks the right one. Root cause of ~4,458 orders stuck at 'sent': orders are
-- created with the API key's environment (e.g. production), but the sync looked
-- them up using the tenant's default environment (e.g. sandbox) — and never
-- found them. Nullable; legacy rows are back-filled by the sync as it discovers
-- each order's environment.
ALTER TABLE orders ADD COLUMN environment TEXT;
