-- Add environment column to api_keys so each key can target sandbox or production independently
ALTER TABLE api_keys ADD COLUMN environment TEXT DEFAULT 'sandbox';
