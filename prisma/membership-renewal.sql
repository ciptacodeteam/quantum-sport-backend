-- Additive and safe to run repeatedly. No existing balance is changed by this SQL.
ALTER TABLE membership_users ADD COLUMN IF NOT EXISTS "renewalAppliedAt" TIMESTAMP(3);
ALTER TABLE membership_users ADD COLUMN IF NOT EXISTS "debtSettledSessions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE membership_session_debits ADD COLUMN IF NOT EXISTS "reversedAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS membership_debt_transfers (
  id TEXT PRIMARY KEY,
  "fromMembershipUserId" TEXT NOT NULL REFERENCES membership_users(id),
  "toMembershipUserId" TEXT NOT NULL REFERENCES membership_users(id),
  sessions INTEGER NOT NULL,
  "restoredSessions" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("fromMembershipUserId", "toMembershipUserId")
);
