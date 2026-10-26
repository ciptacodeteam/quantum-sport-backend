---
name: midtrans-core-bank-transfer
description: Midtrans Core API bank transfer — Virtual Account for BCA, BNI, BRI, Permata, CIMB (payment_type bank_transfer) and Mandiri Bill Payment (payment_type echannel). Request bodies, response fields (va_numbers vs permata_va_number vs bill_key/biller_code), custom VA numbers, expiry, reversal warning. Load for any VA / bank transfer implementation.
---

# Midtrans Core API — Bank Transfer (VA & Bill Payment)

Sources: /reference/payment-bank-transfer, permata/bca/bni/bri/cimb virtual-account pages, mandiri-bill-payment. Danamon VA exists only in the BI-SNAP Core API (out of scope).

## Flow (same for all)
1. `POST /v2/charge` → `201 pending` with VA number (or bill key).
2. Show VA number / bill key + expiry + amount to the customer. Amount must match exactly (closed-amount VA default; open-amount VA must be activated by Midtrans support/sales).
3. Handle notification (`settlement` = paid; `expire`) → `midtrans-core-notifications`.
- Default expiry **24 h**; custom via `custom_expiry` (min 20 s, max 180 days; see json-objects).
- Not refundable via API. Cancel while pending: `POST /v2/{id}/cancel`.
- Possible error codes: 400, 401, 402, 406, 410.
- **Reversal warning (Permata VA, Mandiri Bill; also treat other VA cautiously):** `settlement` can change to `deny` within ~1 minute because the provider reverses the payment. Delay irreversible fulfilment 1–2 min or re-check GET status.

## Request pattern (BCA / BNI / BRI / CIMB)
```json
{
  "payment_type": "bank_transfer",
  "transaction_details": { "order_id": "ORD-1001", "gross_amount": 10000 },
  "customer_details": { "first_name": "budi", "last_name": "utomo", "email": "budi@example.com", "phone": "+6281 1234 1234" },
  "item_details": [ { "id": "1", "price": 10000, "quantity": 1, "name": "Ayam" } ],
  "bank_transfer": { "bank": "bca" }        // bni | bri | cimb | permata
}
```
`bank_transfer` object is required; `customer_details`, `item_details` optional (Σ price×qty must equal gross_amount when sent).

### Per bank specifics
| Bank | `bank_transfer` extras | Notes |
|---|---|---|
| **BCA** | `va_number` (6–18 digits custom), `free_text` {inquiry[], payment[]} each `{id,en}` ≤10 items ≤50 chars, `bca.sub_company_code` (default `00000`) | Name (`first_name`+`last_name`) ≤30 chars. |
| **BNI** | `va_number` custom (8 digits with 5-digit client id; 12 with 3-digit) | Phone must begin `+62` or `0`+area code, ≤30 chars, else rejected. Legacy `payment_amounts` field only filled for BNI — use `gross_amount` instead. |
| **BRI** | `va_number` custom (18 digits) | – |
| **CIMB** | `va_number` custom (12 digits) | `bank:"cimb"` (response `va_numbers[].bank = "cimb"`). |
| **Permata** | `permata.recipient_name` (shown uppercase, 20 chars; default merchant name), `va_number` custom (12) | Response field differs (below). |

Custom `va_number`: shorter than allowed → zero-padded left; longer → trimmed. If the same custom VA number is still active, avoid reuse (cancel/expire first).

## Response shape

**BCA/BNI/BRI/CIMB:**
```json
{ "status_code":"201","status_message":"Success, Bank Transfer transaction is created",
  "transaction_id":"9aed5972-...","order_id":"1466323342","gross_amount":"20000.00",
  "payment_type":"bank_transfer","transaction_time":"2016-06-19 15:02:22",
  "transaction_status":"pending","fraud_status":"accept","currency":"IDR",
  "va_numbers":[ { "bank":"bca","va_number":"91019021579" } ] }
```
**Permata:** `permata_va_number` (string) at top level, plus `expiry_time`; no `va_numbers`.
**Mandiri Bill:** `bill_key`, `biller_code` (`70012`), `expiry_time`.

Robust extraction:
```js
const va = r.va_numbers?.[0]?.va_number ?? r.permata_va_number ?? null;
const bill = r.bill_key ? { billKey: r.bill_key, billerCode: r.biller_code } : null;
```

## Mandiri Bill Payment (`echannel`)
```json
{
  "payment_type": "echannel",
  "transaction_details": { "order_id": "1388", "gross_amount": 95000 },
  "item_details": [ ... ],
  "echannel": { "bill_info1": "Payment For:", "bill_info2": "debt", "bill_key": "081211111111" }
}
```
- `bill_info1` (label ≤10) and `bill_info2` (value ≤30) required; `bill_info3..8` optional pairs; over-length truncated.
- `bill_key` optional custom 6–12 digits; active duplicate → Midtrans returns a random key instead.
- Customer pays at Mandiri ATM / Livin' / internet banking with `biller_code` + `bill_key`.
- Settlement notification includes `approval_code`; status text may be upper-case in some docs → normalise.

## Notifications (payload fields to store)
Pending (201) and settlement (200) and expire (202) all carry `signature_key`, `order_id`, `transaction_id`, `gross_amount` (string `"20000.00"`), the VA/bill identifiers and `transaction_time`. Verify signature per notifications skill; compare `gross_amount` to order total.

## Displaying instructions (UX)
Show: bank name, VA number (copy button), exact amount, expiry time (GMT+7), "pay via ATM/mobile/internet banking". Poll your own order status (not Midtrans) from the UI; the webhook updates it.

## Checklist
- [ ] Choose `bank_transfer` vs `echannel` correctly (Mandiri is echannel).
- [ ] Handle three response shapes (va_numbers / permata_va_number / bill_key).
- [ ] Idempotency-Key not supported for Permata VA — rely on unique `order_id` + GET status after timeout.
- [ ] Settlement→deny reversal delay for Permata/Mandiri.
- [ ] Expiry handled (expire notification → release stock).
- [ ] No refund API for VA: handle manually (bank transfer out) if needed.
- [ ] Stray VA cleanup: `POST /v2/virtual-account/{va}/deactivate` (payment-api skill).
