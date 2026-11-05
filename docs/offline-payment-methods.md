# Offline payment methods

Apply the additive migration before starting the updated backend:

```sh
bun run db:offline-payment-methods
bun run db:generate
```

In **Kelola Metode Pembayaran**, create or edit a method and enable **Pembayaran Offline — Khusus Admin**. Gateway channel is optional for offline methods. The table and form display an **Offline · Khusus Admin** badge separately from active/inactive status.

The public method list excludes `isOffline: true`, even for a method with an otherwise online-compatible channel. Customer court and membership checkout independently reject direct requests using an offline method ID. Existing cash, EDC, QRIS Static and manual transfer channels are classified offline by the migration. Existing payment records and invoices remain intact.

Custom offline methods are selectable when adding a coach or ballboy service from the admin schedule. Admin/cashier must confirm payment receipt. The selected catalog method is stored on the paid payment record and invoice without calling the gateway. An offline method cannot be used as an online gateway method without that confirmation.
