BEGIN;

-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

-- DropIndex
DROP INDEX IF EXISTS "courts_name_key";

-- DropIndex
DROP INDEX IF EXISTS "inventories_name_key";

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "banners" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "partnerships" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "courts" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "inventories" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "promo_codes" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "slots" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "court_cost_schedules" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "class_bookings" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'cemara';

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "mapsUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_branches" (
    "membershipId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "membership_branches_pkey" PRIMARY KEY ("membershipId","branchId")
);

-- CreateIndex
CREATE INDEX "membership_branches_branchId_idx" ON "membership_branches"("branchId");

-- CreateIndex
CREATE INDEX "staff_branchId_idx" ON "staff"("branchId");

-- CreateIndex
CREATE INDEX "banners_branchId_idx" ON "banners"("branchId");

-- CreateIndex
CREATE INDEX "partnerships_branchId_idx" ON "partnerships"("branchId");

-- CreateIndex
CREATE INDEX "courts_branchId_idx" ON "courts"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "courts_branchId_name_key" ON "courts"("branchId", "name");

-- CreateIndex
CREATE INDEX "inventories_branchId_idx" ON "inventories"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "inventories_branchId_name_key" ON "inventories"("branchId", "name");

-- CreateIndex
CREATE INDEX "promo_codes_branchId_idx" ON "promo_codes"("branchId");

-- CreateIndex
CREATE INDEX "slots_branchId_idx" ON "slots"("branchId");

-- CreateIndex
CREATE INDEX "court_cost_schedules_branchId_idx" ON "court_cost_schedules"("branchId");

-- CreateIndex
CREATE INDEX "invoices_branchId_idx" ON "invoices"("branchId");

-- CreateIndex
CREATE INDEX "bookings_branchId_idx" ON "bookings"("branchId");

-- CreateIndex
CREATE INDEX "classes_branchId_idx" ON "classes"("branchId");

-- CreateIndex
CREATE INDEX "class_bookings_branchId_idx" ON "class_bookings"("branchId");

-- CreateIndex
CREATE INDEX "tournaments_branchId_idx" ON "tournaments"("branchId");

-- CreateIndex
CREATE INDEX "notifications_branchId_idx" ON "notifications"("branchId");

-- Preserve all existing operational records at Cemara and enable the two initial branches.
-- Cemara stays the only bookable club. S. Parman is created inactive so existing customers cannot land on an empty branch.
INSERT INTO "branches" ("id", "name", "address", "mapsUrl", "sequence", "isActive") VALUES
('cemara', 'Black Padel Cemara', 'Jl. Cemara No. 51, Pulo Brayan Bengkel Baru, Medan Timur, Kota Medan, Sumatera Utara 20237, Indonesia.', 'https://maps.app.goo.gl/a5b6EUoXWiCnqQVj8', 0, true),
('s-parman', 'Black Padel S. Parman', 'Jl. S. Parman No.269-283, Petisah Hulu, Kec. Medan Baru, Kota Medan, Sumatera Utara 20152', 'https://maps.google.com/maps?ftid=0x3031310010a25ae9:0x14bf370c5ed5f418', 1, false);

INSERT INTO "membership_branches" ("membershipId", "branchId")
SELECT m.id, b.id FROM "memberships" m CROSS JOIN "branches" b;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courts" ADD CONSTRAINT "courts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_cost_schedules" ADD CONSTRAINT "court_cost_schedules_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
