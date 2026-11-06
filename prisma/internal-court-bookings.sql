-- Existing bookings remain regular bookings. Safe to re-run.
DO $$ BEGIN
  CREATE TYPE "BookingPurpose" AS ENUM ('REGULAR', 'COACH_TRAINING', 'EVENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "purpose" "BookingPurpose" NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN IF NOT EXISTS "activityName" TEXT;

-- Internal reservations do not require a customer identity.
ALTER TABLE bookings ALTER COLUMN "userId" DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_regular_customer_check') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_regular_customer_check
      CHECK (purpose <> 'REGULAR' OR "userId" IS NOT NULL);
  END IF;
END $$;
