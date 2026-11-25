-- Run before deploying code. Transactional, additive and safe to rerun.
BEGIN;
LOCK TABLE memberships, membership_users IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE membership_users ADD COLUMN IF NOT EXISTS "purchasedPrice" INTEGER;
ALTER TABLE membership_users ADD COLUMN IF NOT EXISTS "purchasedSessions" INTEGER;
ALTER TABLE membership_users ADD COLUMN IF NOT EXISTS "purchasedDuration" INTEGER;
ALTER TABLE membership_users ADD COLUMN IF NOT EXISTS "purchasedType" "MembershipType";

-- Invoice subtotal excludes payment processing fees and preserves zero-price sales.
UPDATE membership_users AS p
SET "purchasedPrice" = i.subtotal
FROM invoices AS i
WHERE i."membershipUserId" = p.id AND p."purchasedPrice" IS NULL;

-- The master is evidence only if it has not changed since the purchase.
-- Never guess historical quota/type/duration from a subsequently edited master.
UPDATE membership_users AS p
SET "purchasedSessions" = COALESCE(p."purchasedSessions", m.sessions),
    "purchasedDuration" = COALESCE(p."purchasedDuration", m.duration),
    "purchasedType" = COALESCE(p."purchasedType", m.type)
FROM memberships AS m
WHERE p."membershipId" = m.id AND m."updatedAt" <= p."createdAt";
COMMIT;

-- Reconcile these purchases against original records before editing their master.
SELECT p.id, p."membershipId", p."createdAt", p."purchasedPrice",
       p."purchasedSessions", p."purchasedDuration", p."purchasedType"
FROM membership_users AS p
WHERE p."purchasedPrice" IS NULL OR p."purchasedSessions" IS NULL
   OR p."purchasedDuration" IS NULL OR p."purchasedType" IS NULL;
