-- Store what we pushed to AfterShip (webhook secret masked at write time) and
-- the response meta, so the portal can show per-push detail. Additive.
ALTER TABLE aftership_pushes ADD COLUMN request_payload TEXT;
ALTER TABLE aftership_pushes ADD COLUMN response_meta TEXT;
