-- Run before deploying code that reads Staff.mustChangePassword.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE;
