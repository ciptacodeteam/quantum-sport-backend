# Coach and ballboy cancellation

Cancel actions appear in Kelola Pemesanan > Coach / Ballboy. Super admins and cashiers can cancel either service. Existing admin access to ballboy cancellation is retained. Coach replacement remains restricted to super admins.

Individual cancellation requires a reason and the displayed slot ID, rechecks the assignment under transaction locks, records an audit note and cancels only that service. The existing 15-minute cutoff still applies. The service slot reopens only if it is not manually closed and no other active booking holds it. Paid invoice and payment amounts remain unchanged; any required refund must be reviewed manually.

Court cancellation (admin or customer) also cancels active coach and ballboy rows linked by the court booking ID, serviceForBookingId, or courtSlotId for older separate service invoices. The operation runs in the same transaction as court cancellation. Paid add-on invoice history is preserved and the booking receives a manual refund review note. The admin rejection path uses the same service cleanup.

No schema migration is required. This change does not retroactively cancel service rows whose courts were cancelled before deployment. Review those entries in the service booking lists and cancel the affected services explicitly.
