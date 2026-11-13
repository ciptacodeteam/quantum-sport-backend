# Court reschedule charges

Admin and Cashier can preview a move with `PUT /admin/booked-courts/:id/reschedule`, sending `newSlotId` and `preview: true`. The response splits `courtDifference` and `serviceDifference`. To confirm, send `expectedDifference`; if positive, also select an active offline `paymentMethodId` after receiving payment. The backend recomputes the quote inside the serializable transaction.

Each component keeps its highest paid amount. Moving to a higher court or service rate charges only its positive difference; a lower rate does not refund or offset another component. Previously paid reschedule charges count toward subsequent moves. Club court rates use the target happy/peak coaching discount. Direct in-house uses the applicable fixed/Management court price; prepaid in-house benefits remain prepaid. Settled club coaches stay zero.

Original invoices and recorded service prices are preserved. Each positive difference creates a new paid invoice linked to the court booking, with the authoritative allocation in payment metadata. No duplicate court or service reservations are created. Income by Source includes the paid court/service differences; Income Layanan adds only eligible service differences and counts no extra playing hours. Cancellation and club settlement follow the linked service. Equal or cheaper moves create no payment. No database migration is required.

Availability, same sport/branch/duration and membership hour restrictions still apply. Coach and ballboy must be available on the replacement schedule. The original H-2 deadline and Super Admin exception remain unchanged.
