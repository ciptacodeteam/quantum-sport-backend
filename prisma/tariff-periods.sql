CREATE TABLE IF NOT EXISTS "tariff_periods" (
  "id" TEXT PRIMARY KEY,
  "branchId" TEXT NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "sport" "CourtSport" NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "happyStart" INTEGER NOT NULL,
  "happyEnd" INTEGER NOT NULL,
  "peakStart" INTEGER NOT NULL,
  "peakEnd" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tariff_periods_hours_check" CHECK (
    "happyStart" >= 0 AND "happyEnd" <= 24 AND "happyEnd" > "happyStart"
    AND "peakStart" >= 0 AND "peakEnd" <= 24 AND "peakEnd" > "peakStart"
    AND ("happyEnd" = "peakStart" OR "peakEnd" = "happyStart")
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "tariff_periods_branchId_sport_effectiveFrom_key"
  ON "tariff_periods" ("branchId", "sport", "effectiveFrom");
