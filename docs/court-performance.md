# Court Performance

Menu: Analytics → Court Performance (`/admin/analytics/court-performance`).

API GET `/admin/analytics/court-performance` and `/admin/analytics/court-performance/export` accept `startDate`, `endDate` (YYYY-MM-DD, inclusive WIB), and optional `courtId`. Maximum period is 366 days. ADMIN, SUPER_ADMIN and ADMIN_VIEWER may read/export; cashier access is denied. Existing branch context scopes all report queries. No database migration is required.

Only CONFIRMED bookings count; HOLD and CANCELLED bookings are excluded. Filters use playing time, not payment or booking creation time. A booking spanning categories counts once in the overall booking count. Hours crossing a date boundary are clipped to the reporting interval; elapsed and upcoming portions are calculated at report generation time.

Capacity is the union of published, available, non-closed court slots plus confirmed occupied slots, per court. Temporary HOLD reservations remain operational capacity but do not count as confirmed occupancy. Manual/bulk closures are excluded unless occupied. Unbooked future slots beyond a shortened rolling horizon or on inactive courts are excluded; confirmed reservations are retained. Duplicate/overlapping slots do not inflate capacity or occupied hours. Unpublished dates are not estimated, so occupancy describes published capacity, not a theoretical full-month capacity. Historical slot closures and membership catalogue sessions do not have immutable historical snapshots in the current schema.

Revenue lapangan is the paid booking's `courtDiscountPrice` after existing bundle discounts, reduced by a proportional share of order-level promo discounts. Processing fees and add-ons are excluded. It is distributed across regular court details by their relative amounts before filtering courts/dates; a report for one court does not inherit the entire booking revenue. Unpaid invoices contribute hours but no payment revenue. Complimentary means non-membership bookings with a paid invoice and zero court charge.

Value Pack allocations use the paid purchase invoice total minus processing fee, divided by the package's session hours. They are shown separately from court payments: this is usage valuation, not new cash received from selling the package. The current schema has no purchase-session snapshot, so the denominator uses catalogue sessions. Missing/unpaid package purchase invoices yield an explicit unvalued-hours count, never a fabricated rate. Membership mixed bookings identify covered zero-charge details, while legacy admin and recurring membership bookings use their zero court total. Recurring bookings include future reserved sessions even before quota debit.

Nilai pemakaian combines court payments and package allocation. Nilai berlalu prorates that value to time already elapsed; future reservations remain included in the report period total. Tariff labels resolve the branch/sport rule effective on playing date.

Excel exports the same applied period/court report in Ringkasan, Per lapangan, Kategori, Detail booking, and Definisi sheets. Detail search/category/tariff filters are UI drill-down filters; export includes all categories within the applied report period/court.

## Branch comparison

The report now includes `branchId`/branch name on court and detail rows, and a `branchSummary` grouped by playing location. In the All branches view (without an individual-court filter), the UI compares court payments, package allocation, total usage value, occupied hours, published capacity, occupancy and usage-value contribution. Overall occupancy is weighted by summed capacity, not the arithmetic mean of branch percentages. Exports include a Per cabang sheet and branch names on booking details.
