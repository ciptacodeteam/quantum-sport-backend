-- ISO weekdays: Monday=1 ... Sunday=7. Empty preserves existing time bands.
ALTER TABLE "tariff_periods" ADD COLUMN IF NOT EXISTS "happyAllDayDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
