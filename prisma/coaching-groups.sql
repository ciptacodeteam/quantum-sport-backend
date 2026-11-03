-- Additive and repeatable. Existing coaches remain independent; bookings retain their original prices.
CREATE TABLE IF NOT EXISTS coaching_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  logo TEXT,
  description TEXT,
  sports "CourtSport"[] NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS coaching_group_branches (
  "groupId" TEXT NOT NULL REFERENCES coaching_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "branchId" TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY ("groupId", "branchId")
);
CREATE INDEX IF NOT EXISTS "coaching_group_branches_branchId_idx" ON coaching_group_branches("branchId");
CREATE TABLE IF NOT EXISTS coaching_group_coaches (
  "groupId" TEXT NOT NULL REFERENCES coaching_groups(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "staffId" TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY ("groupId", "staffId")
);
CREATE INDEX IF NOT EXISTS "coaching_group_coaches_staffId_idx" ON coaching_group_coaches("staffId");
ALTER TABLE booking_coaches ADD COLUMN IF NOT EXISTS "coachingGroupId" TEXT;
ALTER TABLE booking_coaches ADD COLUMN IF NOT EXISTS "coachingGroupName" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_coaches_coachingGroupId_fkey') THEN
    ALTER TABLE booking_coaches ADD CONSTRAINT "booking_coaches_coachingGroupId_fkey"
      FOREIGN KEY ("coachingGroupId") REFERENCES coaching_groups(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
