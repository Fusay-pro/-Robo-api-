-- Sheet URLs per branch — required for the Google Sheets sync/import feature.
-- The sync code (src/routes/sync.js, src/services/sheetsSync.js) reads these,
-- but the columns were never present in the live DB.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS sheets_operational_id TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS sheets_finance_id     TEXT;
