# Coaching in-house

Admin menu: **Master Data → Coaching In-house** (`/admin/coaching-inhouse`).

## Operation

1. Create the coach profile and available hours using the existing coaching catalog/schedule.
2. Under **Paket & Tarif**, configure each coach's 1, 5 and/or 10-hour products. Price and court allocation are in rupiah per hour. The coach's base share is price minus the court allocation. Creating an active in-house product identifies that coach as an in-house coach for future booking choices; existing club bookings are not repriced.
3. Under **Kuota Customer**, search/select an existing customer, select a product and the offline method through which payment has been received. Confirming records a paid invoice and creates the prepaid hours. Sale retries use an idempotency key.
4. In **Booking Lapangan → Tambah Layanan**, eligible paid packages appear only for their owner, branch and sport. Nothing is selected automatically. Each explicit package choice reserves one hour with its own coach and participant count. Court membership and recurring court bookings cannot cover the same checkout. Selecting club coaching clears any package choice on that playing hour; selecting a package clears club choices on that hour.
5. Packages can be consumed on different dates, are bound to the original coach, and currently have no expiry date. Rates are copied to the wallet on purchase. Catalog edits only affect subsequent purchases.

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
