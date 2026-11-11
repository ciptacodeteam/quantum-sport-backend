ALTER TABLE "tariff_periods"
  ADD COLUMN IF NOT EXISTS "happyInHouseCoachDiscount" INTEGER,
  ADD COLUMN IF NOT EXISTS "peakInHouseCoachDiscount" INTEGER;
DO $$ BEGIN
  ALTER TABLE "tariff_periods" ADD CONSTRAINT "inhouse_coaching_discounts_valid"
  CHECK (("happyInHouseCoachDiscount" IS NULL OR "happyInHouseCoachDiscount" >= 0)
    AND ("peakInHouseCoachDiscount" IS NULL OR "peakInHouseCoachDiscount" >= 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
