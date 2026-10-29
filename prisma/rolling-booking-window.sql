-- Additive and safe to run repeatedly. Existing courts retain their current date-based slots
-- until an administrator saves a rolling schedule.
ALTER TABLE courts ADD COLUMN IF NOT EXISTS "bookingWindowMonths" INTEGER;
ALTER TABLE courts ADD COLUMN IF NOT EXISTS "rollingPricing" JSONB;
ALTER TABLE courts ADD COLUMN IF NOT EXISTS "slotsGeneratedThrough" DATE;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS "scheduleClosed" BOOLEAN NOT NULL DEFAULT false;
