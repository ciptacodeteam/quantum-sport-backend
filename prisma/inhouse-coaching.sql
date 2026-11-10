BEGIN;
SELECT pg_advisory_xact_lock(hashtext('quantum-inhouse-coaching-v1'));

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "inHouseWalletId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "inhouse_plans" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "hourlyPrice" INTEGER NOT NULL,
    "courtHourlyShare" INTEGER NOT NULL,
    "extraParticipantHourlyPrice" INTEGER NOT NULL DEFAULT 100000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inhouse_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "inhouse_wallets" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "saleRequestId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "totalMinutes" INTEGER NOT NULL,
    "remainingMinutes" INTEGER NOT NULL,
    "hourlyPrice" INTEGER NOT NULL,
    "courtHourlyShare" INTEGER NOT NULL,
    "extraParticipantHourlyPrice" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inhouse_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "inhouse_usages" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "bookingCoachId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "participants" INTEGER NOT NULL,
    "courtAmount" INTEGER NOT NULL,
    "coachAmount" INTEGER NOT NULL,
    "extraAmount" INTEGER NOT NULL,
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inhouse_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inhouse_plans_branchId_staffId_idx" ON "inhouse_plans"("branchId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "inhouse_wallets_saleRequestId_key" ON "inhouse_wallets"("saleRequestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inhouse_wallets_branchId_userId_remainingMinutes_idx" ON "inhouse_wallets"("branchId", "userId", "remainingMinutes");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "inhouse_usages_bookingCoachId_key" ON "inhouse_usages"("bookingCoachId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inhouse_usages_branchId_walletId_idx" ON "inhouse_usages"("branchId", "walletId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_inHouseWalletId_key" ON "invoices"("inHouseWalletId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_inHouseWalletId_fkey" FOREIGN KEY ("inHouseWalletId") REFERENCES "inhouse_wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "inhouse_plans" ADD CONSTRAINT "inhouse_plans_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "inhouse_wallets" ADD CONSTRAINT "inhouse_wallets_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "inhouse_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "inhouse_wallets" ADD CONSTRAINT "inhouse_wallets_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "inhouse_wallets" ADD CONSTRAINT "inhouse_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "inhouse_usages" ADD CONSTRAINT "inhouse_usages_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "inhouse_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "inhouse_usages" ADD CONSTRAINT "inhouse_usages_bookingCoachId_fkey" FOREIGN KEY ("bookingCoachId") REFERENCES "booking_coaches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  ALTER TABLE inhouse_plans ADD CONSTRAINT inhouse_plan_valid_terms CHECK (hours IN (1,5,10) AND "hourlyPrice" > 0 AND "courtHourlyShare" >= 0 AND "courtHourlyShare" <= "hourlyPrice" AND "extraParticipantHourlyPrice" = 100000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE inhouse_wallets ADD CONSTRAINT inhouse_wallet_valid_balance CHECK ("remainingMinutes" >= 0 AND "remainingMinutes" <= "totalMinutes" AND "totalMinutes" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE inhouse_usages ADD CONSTRAINT inhouse_usage_valid_amounts CHECK (minutes = 60 AND participants BETWEEN 1 AND 100 AND "courtAmount" >= 0 AND "coachAmount" >= 0 AND "extraAmount" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- A dedicated service type avoids runtime writes to the shared club catalog.
INSERT INTO coach_types (id, name, description, "isActive", "createdAt", "updatedAt")
VALUES ('inhouse-coaching-type-v1', 'Coaching In-house', 'Pemakaian kuota coach in-house', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (name) DO NOTHING;
COMMIT;
