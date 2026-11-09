# Coach and ballboy cancellation

Cancel actions appear in Kelola Pemesanan > Coach / Ballboy. Super admins and cashiers can cancel either service. Existing admin access to ballboy cancellation is retained. Coach replacement remains restricted to super admins.

Individual cancellation requires a reason and the displayed slot ID, rechecks the assignment under transaction locks, records an audit note and cancels only that service. The existing 15-minute cutoff still applies. The service slot reopens only if it is not manually closed and no other active booking holds it. Paid invoice and payment amounts remain unchanged; any required refund must be reviewed manually.

Court cancellation (admin or customer) also cancels active coach and ballboy rows linked by the court booking ID, serviceForBookingId, or courtSlotId for older separate service invoices. The operation runs in the same transaction as court cancellation. Paid add-on invoice history is preserved and the booking receives a manual refund review note. The admin rejection path uses the same service cleanup.

No schema migration is required. This change does not retroactively cancel service rows whose courts were cancelled before deployment. Review those entries in the service booking lists and cancel the affected services explicitly.

## Direct confirmation of admin-added services

Adding a coach, ballboy, or both to an existing confirmed court booking immediately creates CONFIRMED service rows and a PAID invoice at the selected service rates. The invoice has paidAt and no processing fee or payment-method record. The booking records the cashier and confirmation time. No gateway request or temporary payment hold is created. Cancellation continues to exclude cancelled service rows from income, while preserving the paid invoice history.

## Cancelling unpaid services

The cancel action also supports HOLD (Menunggu pembayaran), including older service rows marked CONFIRMED under a HOLD booking. It requires the same role, reason, slot version and 15-minute cutoff as confirmed-service cancellation. Cancelling an unpaid service does not require confirming payment and does not alter invoice/payment amounts or other services.

If an old HOLD booking later expires, only slots without another active booking can be reopened; manually closed slots stay closed. Late payment reconciliation requires manual review if it would revive a service cancelled independently before the booking expiry. Cancelled service rows remain excluded from service income and exports.
