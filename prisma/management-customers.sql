-- Apply before deploying the Management customer and pricing feature.
BEGIN;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "isManagement" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "managementValidFrom" DATE;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "managementValidUntil" DATE;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "managementAssignedBy" TEXT;
ALTER TABLE "tariff_periods" ADD COLUMN IF NOT EXISTS "managementCourtHourlyPrice" INTEGER;
ALTER TABLE "tariff_periods" ADD COLUMN IF NOT EXISTS "managementCoachHourlyPrice" INTEGER;
COMMIT;
