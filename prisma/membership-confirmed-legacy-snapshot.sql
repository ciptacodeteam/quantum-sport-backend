-- One-time repair: the owner confirmed on 2026-11-25 that existing package
-- price, quota, duration and hour type have never changed. Run before editing them.
-- Deliberately excluded from Docker startup: this confirmation is not perpetual.
BEGIN;
LOCK TABLE memberships, membership_users, invoices IN SHARE ROW EXCLUSIVE MODE;

UPDATE membership_users AS p
SET "purchasedPrice" = COALESCE(
      p."purchasedPrice",
      (SELECT i.subtotal FROM invoices AS i WHERE i."membershipUserId" = p.id),
      m.price
    ),
    "purchasedSessions" = COALESCE(p."purchasedSessions", m.sessions),
    "purchasedDuration" = COALESCE(p."purchasedDuration", m.duration),
    "purchasedType" = COALESCE(p."purchasedType", m.type)
FROM memberships AS m
WHERE p."membershipId" = m.id
  AND p."createdAt" < TIMESTAMPTZ '2026-11-26 00:00:00+07'
  AND (p."purchasedPrice" IS NULL OR p."purchasedSessions" IS NULL
    OR p."purchasedDuration" IS NULL OR p."purchasedType" IS NULL);

COMMIT;

SELECT count(*) AS unresolved_purchases
FROM membership_users
WHERE "purchasedPrice" IS NULL OR "purchasedSessions" IS NULL
   OR "purchasedDuration" IS NULL OR "purchasedType" IS NULL;
