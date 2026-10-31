CREATE TABLE IF NOT EXISTS recurring_bookings (
  id TEXT PRIMARY KEY,
  "branchId" TEXT NOT NULL REFERENCES branches(id),
  "userId" TEXT NOT NULL REFERENCES "user"(id),
  "membershipUserId" TEXT NOT NULL REFERENCES membership_users(id),
  weekdays INTEGER[] NOT NULL,
  templates JSONB NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "processedThrough" DATE NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "stoppedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS recurring_bookings_branch_active ON recurring_bookings ("branchId", "isActive");
CREATE TABLE IF NOT EXISTS recurring_booking_occurrences (
  id TEXT PRIMARY KEY,
  "branchId" TEXT NOT NULL,
  "seriesId" TEXT NOT NULL REFERENCES recurring_bookings(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  "bookingId" TEXT REFERENCES bookings(id),
  reason TEXT,
  UNIQUE ("seriesId", date)
);
CREATE INDEX IF NOT EXISTS recurring_occurrences_branch ON recurring_booking_occurrences ("branchId");

CREATE TABLE IF NOT EXISTS membership_session_debits (
  id TEXT PRIMARY KEY,
  "branchId" TEXT NOT NULL,
  "detailId" TEXT NOT NULL UNIQUE REFERENCES booking_details(id),
  "membershipUserId" TEXT NOT NULL REFERENCES membership_users(id),
  sessions INTEGER NOT NULL,
  "chargedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS membership_session_debits_branch ON membership_session_debits ("branchId");
