-- Existing packages stay public. Run before deploying the visibility feature.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT TRUE;
