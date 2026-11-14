# Coach & ballboy income

Admin menu: **Analytics → Income Layanan**.

The report calculates club entitlements, not transfers or settlement status. The
club receives 100% of paid service amounts after order-level promo allocation.
Court/equipment charges and processing fees do not become service income.

## Eligibility and attribution

- The payment period uses `Invoice.paidAt` (actual instants, displayed in WIB),
  independently of the session's playing date.
- Only paid invoices for confirmed regular bookings contribute. Pending, expired,
  cancelled or refunded invoices and internal training/event court reservations
  are excluded. Cancelled service lines are excluded even if their original
  invoice remains paid while a manual refund is being reviewed.
- Coach clubs use `BookingCoach.coachingGroupId` and the captured
  `coachingGroupName`, not current staff memberships. A removed group's captured
  name is retained as a separate historical recipient.
- Ballboys have no recorded group relationship and appear as **Tanpa Club**.
  Legacy coach rows without a club snapshot are also unassigned. These amounts
  remain included in the report and are shown explicitly.
- Payment allocation uses whole rupiah and a deterministic largest-remainder
  calculation, including the non-service share and cancelled service lines in
  the allocation. A cancelled line's share is not redistributed to another club.

## Access, filters and exports

`GET /admin/analytics/coach-ballboy-income` and `/export` accept required
`startDate`, `endDate` ISO timestamps and optional `clubId`, `staffId`, `service`
(`COACH` or `BALLBOY`). `clubId=unassigned` selects Tanpa Club. The maximum period
is 366 days. Super admins, admins and admin viewers can read the report; the
existing branch-scoped Prisma client enforces the selected/assigned branch.

All summaries, club totals, staff totals and transaction rows use the same
filtered set. Staff/club choices are drawn from the entire selected period.
Transaction search only narrows the detail table; its footer is labelled
separately. Export Excel follows the period, branch and report filters and
includes summary, club, staff, transactions and calculation definitions.

No database migration is needed; existing booking/service snapshots are used.

## In-house usage

The separate in-house section and Excel sheet show customers, coaches, packages,
session times, hours, participants, package coach allocation, and extra-participant
charges. Paid hourly in-house bookings also appear as Satuan, with their recorded
service price (including any participant surcharge). Participant counts for these
rows follow the recorded session description; unavailable counts remain blank.
The period follows session start time in WIB, so packages sold before the
selected period still show their usage. Only active, unrestored usage from paid,
undeleted wallets and confirmed regular coach bookings is included. Hourly rows
require a paid booking invoice and exclude sessions linked to a package usage.
Branch scoping
is enforced by the existing Prisma client.

These informational amounts do not increase club entitlements or recognize package
revenue again. `service=INHOUSE` selects in-house usage only; `service=COACH` includes
both coach categories in their separate sections. Staff filters apply to both;
selecting a club excludes in-house usage. Search and pagination in the in-house
table affect only its displayed rows; exports follow the report filters.

## Checks

```sh
npm test -- src/services/service-income.service.test.ts
RUN_SERVICE_INCOME_DB_TESTS=1 node --import dotenv/config node_modules/vitest/vitest.mjs run src/services/service-income.integration.test.ts
```

The opt-in integration suite creates and removes isolated local test records.
