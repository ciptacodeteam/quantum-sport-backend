# Rolling service schedules

Coach and ballboy availability can follow court rolling windows without service start/end dates.

Apply the additive schema change before starting the updated backend:

```sh
bun run db:rolling-service-schedule
bun run db:generate
```

Open each service's **Jadwal & Harga**, select its active weekdays, start/end hour and hourly tariff, then save once. Existing date-based slots and bookings are retained; no recurring rule is inferred from historical slots. The frontend sends `followCourtWindow: true` without `fromDate` or `toDate`. Legacy date-based API requests remain supported.

The persisted rule generates one service slot for each matching one-hour court time in the same branch and eligible sport, within the court's rolling horizon and open schedule. Multiple courts at the same time share one staff slot. Ballboys follow tennis courts; dual-sport coaches follow both sports. A court already booked still supplies its scheduled time, allowing a coach or ballboy to be attached to that booking later.

Court schedule reads, service availability reads and the existing scheduler reconcile service slots. New court dates create new service slots automatically. Future unbooked service slots outside the new court schedule are marked `scheduleClosed`. Booked slots and manual closures (`isAvailable: false`) are preserved. Routine extension preserves per-slot price edits; saving the rule updates the price of open matching slots.
