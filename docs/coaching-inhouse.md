# Coaching in-house

Operations menu: **Booking System → Coaching In-house** (`/admin/coaching-inhouse`).

## Operation

1. Create the coach profile under **Master Data → Coach In-house** (`/admin/coach-inhouse`) and configure available hours from its schedule action. Only admins manage profiles. Cashiers access package sales and balances under **Booking System → Coaching In-house**.
2. Open **Master Data → Coach In-house → Jadwal & Harga → Paket & Tarif** for the selected coach. ADMIN and SUPER_ADMIN configure that coach's products with any positive whole-hour quota, typed directly in the form. Price and court allocation are in rupiah per hour. The coach's base share is price minus the court allocation. Creating an active in-house product identifies that coach as an in-house coach for future booking choices; existing club bookings are not repriced.
3. Under **Kuota Customer**, search/select an existing customer, select a product and the offline method through which payment has been received. Confirming records a paid invoice and creates the prepaid hours. Sale retries use an idempotency key.
4. In **Booking Lapangan → Tambah Layanan**, eligible paid packages appear only for their owner, branch and sport. Nothing is selected automatically. Each explicit package choice reserves one hour with its own coach and participant count. Court membership and recurring court bookings cannot cover the same checkout. Selecting club coaching clears any package choice on that playing hour; selecting a package clears club choices on that hour.
5. Packages can be consumed on different dates, are bound to the original coach, and currently have no expiry date. Rates are copied to the wallet on purchase. Catalog edits only affect subsequent purchases.

## Coaching satuan (admin only)

An active coach marked **Coach In-house** appears under **Booking Lapangan → Tambah Layanan → In-house**, even when the customer owns no package and the coach has no 1-hour product. Choose the coach explicitly; its available slot price and consecutive additional-hour price come from **Jadwal & Harga**. Customer packages remain separate explicit choices and are scoped to their owner, branch and sport.

In **Pengaturan Jam Tarif → Coach In-house · Satuan**, enable **Harga lapangan fixed** and enter the final court price per hour, e.g. Rp250,000. This is a final price, not a discount amount, and applies equally to happy and peak hours. The hourly checkout adds the scheduled coach charge and Rp100,000 per additional participant. A Rp150,000 happy-hour court and a Rp300,000 peak-hour court both become Rp250,000 when configured that way. With a Rp400,000 coach, either session totals Rp650,000 for one participant. The fixed setting does not alter prepaid quota or package allocations.

Before deploying this feature, connect a PostgreSQL SQL editor (for example, pgAdmin or DBeaver) to the database used by the target backend and execute the SQL below directly. The same SQL is kept in `prisma/inhouse-fixed-court-price.sql` for reference; no package command or backend-container command is required for this schema change.

```sql
ALTER TABLE "tariff_periods" ADD COLUMN IF NOT EXISTS "inHouseCourtHourlyPrice" INTEGER;
DO $$ BEGIN
  ALTER TABLE "tariff_periods" ADD CONSTRAINT "inhouse_fixed_court_price_valid" CHECK ("inHouseCourtHourlyPrice" IS NULL OR "inHouseCourtHourlyPrice" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

The additive, repeatable SQL creates the nullable `tariff_periods.inHouseCourtHourlyPrice` column and rejects negative prices. Existing discount fields are retained for compatibility; they are never reinterpreted as final prices. Saving the new fixed-price form clears the old in-house discount fields for that rule. Previously saved 1-hour product checkouts remain supported. Apply this SQL before starting the updated backend; pushing or deploying code alone does not apply this schema change.

Direct sessions save the court allocation and coach amount on the booking lines and appear on its paid invoice. They do not issue, consume or restore prepaid quota; **Riwayat & Pembagian** remains the prepaid redemption ledger. Both direct and prepaid in-house sessions are excluded from club settlement. Cancel or reschedule through their linked court booking so the bundled court and coaching stay together.

The server re-reads coach slot prices, fixed court settings or prepaid terms, checks branch/sport/coach availability and calculates every amount inside checkout's transaction. Customer checkout and promo endpoints reject `inHouseSelections`; the customer-facing UI has no in-house selection controls.

The prepaid package covers the selected court hour in full. For a normal court price of Rp300,000 and package court share of Rp250,000, the court allocation is Rp250,000 and the customer is not charged for that court hour again. The entire Rp100,000 per additional participant per hour is allocated to the coach. Other court hours and other services remain payable normally.

**Riwayat & Pembagian** lists the saved base coach share, court share and extra participant amount per redemption. Cancelled rows are marked and retain their history. Package purchases appear in invoices and Income as **Paket Coach In-house**. Redemption does not count the original package sale again. In-house allocations are excluded from club payables and club settlement controls.

The list/history endpoints show the latest 500 matching records. Search/select a customer to narrow the list.

## Cancellation and safeguards

- Quota debit, coach availability claim, booking and invoice are within one transaction. Quota updates require sufficient remaining minutes and serialize on the wallet.
- Duplicate checkout attempts cannot claim the same coach slot twice. Concurrent sale retries cannot issue multiple wallets for the same request.
- Cancelling a court booking cancels linked coaching and returns its minutes once. Coaching-only cancellation is blocked for in-house sessions because leaving a prepaid court reserved while restoring the package would grant a free court booking. Cancel the court booking instead. Any extra-participant refund remains subject to the existing manual refund flow.
- Coach replacement is blocked for a package session. Cancel and book again using the same package coach.
- The existing club discount path is unchanged in its rates and formula. The dedicated internal in-house service type is excluded from the generic club type lookup and hidden from the public active-type catalog.
- Plans, wallets, ledger rows, coach and court references are branch-scoped. Only admins manage prices; admins/cashiers may sell; viewers have read-only access.

## Deployment

The Docker startup entrypoint applies `prisma/inhouse-coaching.sql` automatically before starting the application. The script is repeatable and serialized with a transaction advisory lock. For deployments that do not use that entrypoint, apply the additive database script **before starting code which queries the new models**:

```sh
npm run db:inhouse-coaching
npm run db:generate
```

The SQL is transactional and creates three new tables, one nullable invoice relationship, integrity checks, and an internal service type. It does not change existing club tariffs or migrate/reprice existing bookings. The script can safely be run again, following this repository's existing `prisma db execute` convention.

Then deploy the backend and frontend. Configure the actual rates for each coach; no unconfirmed prices for other coaches are seeded.

## Verification

Unit tests cover price allocation, package ownership, coach/sport/branch matching, insufficient quota, no stacking with club discounts, idempotent sale/restoration, invoice amounts, and admin/cashier/viewer permissions. Existing club checkout, cancellations and reporting regression tests are retained.

Optional integration test (an isolated database with the new schema is required):

```sh
TEST_INHOUSE_DATABASE_URL='postgresql://...isolated-test-database...' npx vitest run src/services/inhouse-coaching.integration.test.ts
```

It creates and removes prefixed fixtures, checks concurrent last-hour redemption/rollback, concurrent sale retries, frozen purchase terms and branch isolation. Never point test database variables at production.

## Delete unused customer packages

Apply `npm run db:inhouse-wallet-deletion` and regenerate Prisma Client (`npm run db:generate`) before deploying this change, including on existing installations.

In **Kuota Customer**, ADMIN, SUPER_ADMIN and CASHIER can select **Hapus** and confirm the customer package. Only packages with the full original balance and no usage history can be removed. Restored/cancelled usage still counts as prior use. The service locks the wallet with the same row lock as redemption so deletion and checkout cannot both succeed.

Deletion stores `deletedAt` and `deletedById`, hides the package from wallet lists and rejects future redemption. The purchase invoice, payment, sale request ID and original balance remain available for audit; this action does not refund or cancel the payment. Retrying the original sale cannot recreate the deleted quota.

## In-house coach master data migration

Before deployment, run `npm run db:inhouse-coach-profiles` and `npm run db:generate`.
This adds `Staff.isInHouseCoach` and marks existing coaches with in-house plans (including inactive plans) as in-house, preserving existing package configuration. New profiles created through **Master Data → Coach In-house** carry this marker immediately, independently of tariff creation. The tariff dropdown only lists active marked coaches; the backend enforces the same restriction on tariff writes. Ordinary profile edits preserve the marker when it is omitted.

## Separate court discounts for Club and hourly In-house coaching

Configure **Master Data → Pengaturan Jam Tarif → Potongan lapangan coaching** for the selected branch and sport. Club and hourly In-house coaching have separate Happy Hour/Peak Hour amounts and share the selected tariff bands, full Happy Hour days, and effective playing date. Existing Club values remain unchanged.

Hourly In-house coaching defaults to the inclusive single-hour tariff (`NULL` amounts). Enable **Gunakan potongan coaching satuan** and save both amounts to apply court discounts to direct hourly coaching (`planId`) only. Zero disables the discount for that band; disabling the option restores the inclusive single-hour tariff. Prepaid wallet redemptions (`walletId`) never use this setting. Discounts cannot exceed the court price and Club/In-house cannot stack on one court hour.

With explicit in-house discounts:

- Direct coaching: discounted court price + coach share + participant extras.
- Prepaid wallet: the court remains covered by the purchased package; only participant extras are charged at redemption. Frozen package coach/court allocations are preserved.
- Example: with a Rp350,000 court and Rp50,000 hourly discount, direct hourly coaching pays Rp300,000 for the court plus the coach share. Redeeming a prepaid package does not use that discount and does not add a court top-up.

The frontend preview and server checkout use the playing-date tariff. Saved booking prices are retained when tariff settings change. Apply `npm run db:inhouse-coaching-discounts` before deploying the new Prisma Client. Production Docker startup also applies this additive SQL script automatically before starting the app.

## Package management location

**Booking System → Coaching In-house** contains customer package sales, quota balances, and usage history. Its package-management tab has been removed for all roles. Cashiers can still select existing active packages when recording sales.

**Master Data → Coach In-house → Jadwal & Harga → Paket & Tarif** contains package cards, details and create/edit controls for the opened coach only. The coach is fixed by the profile; the form cannot switch staff. Only ADMIN and SUPER_ADMIN can access this editor, and backend plan writes continue to enforce `requireAdmin`.
