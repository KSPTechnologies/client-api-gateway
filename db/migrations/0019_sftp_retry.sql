-- 0019: SFTP transient-failure retry with backoff (Gray Tools, 2026-11-18).
-- Transient errors (Logiwa 5xx, network, R2 internal) leave the file in in/
-- and schedule a reattempt; data errors (4xx) still fail fast to failed/.
-- retry_count: transient retries consumed for the current in/ file.
-- next_retry_at: UTC datetime before which the connector must not reattempt.
ALTER TABLE sftp_files ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sftp_files ADD COLUMN next_retry_at TEXT;
