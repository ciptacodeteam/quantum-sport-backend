---
name: midtrans-core-otc
description: Midtrans Core API Over-The-Counter (convenience store) payments — Indomaret and Alfamart/Alfamidi/Dan+Dan via payment_type cstore; payment_code, expiry, free text, settlement reversal warning. Load for convenience-store payment implementation.
---

# Midtrans Core API — Over The Counter (cstore)

Sources: /reference/payment-method-over-the-counter-otc, /indomaret-1, /alfamart-1.

Flow: charge → `201 pending` + `payment_code` → show the code + amount + expiry → customer pays at the store → notification `settlement` (or `expire`).
Default expiry **24 h** (min 20 s, max 180 days; `custom_expiry`). Error codes: 400, 401, 402, 406, 410. No API refund. Cancel while pending is allowed.

**Reversal warning**: Indomaret `settlement` can turn into `deny` within ~1 min (provider reversal). Delay irreversible fulfilment 1–2 minutes / re-check GET status.

## Indomaret
```json
{ "payment_type":"cstore",
  "transaction_details":{"order_id":"order04","gross_amount":162500},
  "cstore":{"store":"Indomaret","message":"Tiket1 transaction"},
  "customer_details":{"first_name":"Budi","last_name":"Utomo","email":"budi@example.com","phone":"0811223344"},
  "item_details":[{"id":"id1","price":162500,"quantity":1,"name":"tiket1"}] }
```
- `cstore.store` = `Indomaret` (docs sample; notifications report `store:"indomaret"`), `message` ≤20 chars (shown on POS).
- Response: `payment_code` (e.g. `25709650945026`), `expiry_time`, `transaction_status: pending`.
- Notification statuses: `pending`, `settlement` (adds `approval_code`), `expire`.
- Idempotency-Key is **not supported** for Indomaret.

## Alfamart (Alfamart, Alfamidi, DAN+DAN)
```json
{ "payment_type":"cstore",
  "transaction_details":{"order_id":"order05","gross_amount":162500},
  "cstore":{"store":"alfamart",
    "alfamart_free_text_1":"Thanks for shopping with us!,",
    "alfamart_free_text_2":"Like us on our Facebook page,",
    "alfamart_free_text_3":"and get 10% discount on your next purchase."}, ... }
```
- `alfamart_free_text_1..3` ≤40 chars each (receipt lines). Avoid `|` in `item_details[].name`.
- Response: `payment_code` (e.g. `010811223344`), `store:"alfamart"`, `fraud_status`.
- Alfamart payment code is shown by the customer to the cashier; the amount must be paid in full.

## UI guidance
Show: store logo, payment code (copy/print/barcode if you generate), exact amount, expiry (GMT+7), steps "Tell the cashier you pay Midtrans/…". Don't mark paid until settlement notification.

## Checklist
- [ ] `store` value matches exactly (`indomaret`/`alfamart`).
- [ ] Persist `payment_code`, `expiry_time`.
- [ ] Notification verified + amount matches; reversal-safe fulfilment (Indomaret).
- [ ] Expire handling releases stock.
