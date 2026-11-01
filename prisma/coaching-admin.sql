-- Additive, repeatable migration. Existing staff and booking history stay intact.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "adminServiceOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE booking_coaches ADD COLUMN IF NOT EXISTS "courtSlotId" TEXT;
CREATE INDEX IF NOT EXISTS "booking_coaches_courtSlotId_idx" ON booking_coaches ("courtSlotId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_coaches_courtSlotId_fkey') THEN
    ALTER TABLE booking_coaches ADD CONSTRAINT "booking_coaches_courtSlotId_fkey"
      FOREIGN KEY ("courtSlotId") REFERENCES slots(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
INSERT INTO coach_types (id, name, description, "isActive", "createdAt", "updatedAt")
VALUES ('coaching-admin-default', 'Coaching', 'Sesi coach yang dikelola admin', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS "serviceForBookingId" TEXT;
CREATE INDEX IF NOT EXISTS "bookings_serviceForBookingId_idx" ON bookings ("serviceForBookingId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_serviceForBookingId_fkey') THEN
    ALTER TABLE bookings ADD CONSTRAINT "bookings_serviceForBookingId_fkey"
      FOREIGN KEY ("serviceForBookingId") REFERENCES bookings(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
