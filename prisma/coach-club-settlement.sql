-- Existing coach bookings remain payable until explicitly marked settled by staff.
ALTER TABLE booking_coaches ADD COLUMN IF NOT EXISTS "isClubSettled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE booking_coaches ADD COLUMN IF NOT EXISTS "clubSettlementUpdatedAt" TIMESTAMP(3);
ALTER TABLE booking_coaches ADD COLUMN IF NOT EXISTS "clubSettlementUpdatedById" TEXT;
