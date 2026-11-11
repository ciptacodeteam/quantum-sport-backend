BEGIN;
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "isInHouseCoach" BOOLEAN NOT NULL DEFAULT false;
-- Preserve existing package coaches in the new master data catalog.
UPDATE "staff" SET "isInHouseCoach" = true
WHERE "role" = 'COACH' AND EXISTS (
  SELECT 1 FROM "inhouse_plans" WHERE "staffId" = "staff"."id"
);
COMMIT;
