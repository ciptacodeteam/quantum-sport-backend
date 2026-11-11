ALTER TABLE "tariff_periods" ADD COLUMN IF NOT EXISTS "inHouseCourtHourlyPrice" INTEGER;
DO $$ BEGIN
  ALTER TABLE "tariff_periods" ADD CONSTRAINT "inhouse_fixed_court_price_valid" CHECK ("inHouseCourtHourlyPrice" IS NULL OR "inHouseCourtHourlyPrice" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
