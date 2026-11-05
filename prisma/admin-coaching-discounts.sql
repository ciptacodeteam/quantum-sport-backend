-- Additive and repeatable. Zero disables the admin-only court discount for that band.
ALTER TABLE tariff_periods ADD COLUMN IF NOT EXISTS "happyCoachDiscount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tariff_periods ADD COLUMN IF NOT EXISTS "peakCoachDiscount" INTEGER NOT NULL DEFAULT 0;
