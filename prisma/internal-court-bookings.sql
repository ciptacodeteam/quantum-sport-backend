-- Existing bookings remain regular bookings. Safe to re-run.
DO $$ BEGIN
  CREATE TYPE "BookingPurpose" AS ENUM ('REGULAR', 'COACH_TRAINING', 'EVENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "purpose" "BookingPurpose" NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN IF NOT EXISTS "activityName" TEXT;
