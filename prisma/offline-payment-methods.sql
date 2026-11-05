-- Repeatable migration. Existing manual methods are explicitly classified as offline.
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS "isOffline" BOOLEAN NOT NULL DEFAULT false;
UPDATE payment_methods SET "isOffline" = true
WHERE channel IN ('CASH', 'EDC', 'QRIS_STATIC', 'BANK_TRANSFER_MANUAL');
