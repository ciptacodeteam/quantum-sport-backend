# Training coach and event court bookings

Admin uses the existing Booking Lapangan screen, selects a customer or walk-in
responsible contact, and selects the court slots as usual. Choose **Training Coach**
or **Event**, fill the coach/event name, then **Simpan Booking**. These bookings
skip add-ons and payment. No check-in or attendance feature is involved.

`POST /admin/bookings/internal` accepts `purpose` (`COACH_TRAINING` or `EVENT`),
`activityName`, `courtSlots`, `userId` or walk-in `name` and `phone`, and optional
`adminNote`. It requires an authenticated admin and the existing branch scope.

The transaction claims slots using the same atomic availability checks, rolling
booking horizon and 15-minute cutoff as regular checkout, then creates a confirmed
booking with zero booking/detail prices. It creates no invoice, payment or
membership usage, so it contributes no revenue. The shared slot availability makes
the courts unavailable to both customers and admins. Existing cancellation releases
the slots; rescheduling preserves zero prices. Activity labels appear in the admin
schedule, booking table and detail dialog.

## Database rollout

Before starting the updated backend, run:

```sh
npm run db:internal-court-bookings
npm run db:generate
```

The additive, idempotent SQL adds `BookingPurpose` and `bookings.purpose` /
`bookings.activityName`. Existing bookings default to `REGULAR`. The Docker
entrypoint also applies this SQL during deployment.

## Verification

```sh
npm test -- src/services/internal-court-booking.service.test.ts
RUN_INTERNAL_BOOKING_DB_TESTS=1 npm test -- src/services/internal-court-booking.integration.test.ts
```

The integration test uses isolated records in the configured development database
and removes them afterward. It covers simultaneous booking attempts, zero revenue,
branch isolation, and cancellation/rebooking.
