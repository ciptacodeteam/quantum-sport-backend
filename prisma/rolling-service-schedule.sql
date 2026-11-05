-- Additive, repeatable migration. Existing service slots and bookings are preserved.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "rollingServiceSchedule" JSONB;
