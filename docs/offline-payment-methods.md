# Offline payment methods

Apply the additive migration before starting the updated backend:

```sh
bun run db:offline-payment-methods
bun run db:generate
```

In **Kelola Metode Pembayaran**, create or edit a method and enable **Pembayaran Offline — Khusus Admin**. Gateway channel is optional for offline methods. The table and form display an **Offline · Khusus Admin** badge separately from active/inactive status.

The public method list excludes `isOffline: true`, even for a method with an otherwise online-compatible channel. Customer court and membership checkout independently reject direct requests using an offline method ID. Existing cash, EDC, QRIS Static and manual transfer channels are classified offline by the migration. Existing payment records and invoices remain intact.

Custom offline methods are selectable when adding a coach or ballboy service from the admin schedule. Admin/cashier must confirm payment receipt. The selected catalog method is stored on the paid payment record and invoice without calling the gateway. An offline method cannot be used as an online gateway method without that confirmation.

## Court booking and walk-in checkout

The final **Tambah Layanan / Konfirmasi Booking** summary also provides an offline/admin-only payment selector for registered customers and walk-ins. Active catalog methods marked `isOffline`, and legacy CASH/EDC/QRIS_STATIC/BANK_TRANSFER_MANUAL methods, are eligible. Online-only and inactive methods are excluded.

For a positive balance, `POST /admin/checkout` requires `paymentMethodId`. Clicking **Konfirmasi Booking** directly records the payment and invoice as paid; there is no separate receipt checkbox. The endpoint validates the method under a database lock, creates a paid payment record without gateway fees, and links it to the invoice in the same transaction as the booking. The payment metadata records the cashier and received time. A zero-balance booking, including a fully covered membership booking, does not require a payment method or create a fictitious payment record.

The selected offline method is retained when adding or removing a service before confirming the booking.
