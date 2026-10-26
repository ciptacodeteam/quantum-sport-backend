---
name: midtrans-core-payment-api
description: Midtrans Core API Payment API endpoints — POST /v2/charge, GET status (and status/b2b), capture, approve, deny, cancel (incl. multi-use VA), expire, refund and direct refund (windows, refund_key, partial), register card, point inquiry, BIN API, Deactivate VA, GoPay pay-account endpoints. Load when implementing order lifecycle operations after or besides a charge.
---

# Midtrans Core API — Payment API (endpoint catalogue)

Sources: /reference/overview-17 and each endpoint page. `BASE` = sandbox/production base URL (see `midtrans-core-foundations`). `{id}` = `order_id` **or** `transaction_id` unless stated.

| Method | Path | Purpose | Auth key |
|---|---|---|---|
| GET | `/v2/token` | Tokenize card (client-side, JS lib) | Client Key |
| POST | `/v2/charge` | Create a transaction (any payment type) | Server |
| POST | `/v2/capture` | Capture an `authorize`d card / GoPay pre-auth | Server |
| POST | `/v2/{id}/approve` | Accept card txn with `fraud_status: challenge` | Server |
| POST | `/v2/{id}/deny` | Reject challenged card txn | Server |
| POST | `/v2/{id}/cancel` | Void before settlement / cancel pending | Server |
| POST | `/v2/{id}/expire` | Force `pending` → `expire` | Server |
| POST | `/v2/{id}/refund` | Refund a settled txn (standard) | Server |
| POST | `/v2/{id}/refund/online/direct` | Direct refund (sent straight to bank/provider) | Server |
| GET | `/v2/{id}/status` | Transaction status | Server |
| GET | `/v2/{id}/status/b2b` | Status of all B2B txns of an order_id | Server |
| GET | `/v2/card/register` | Register card for one/two-click | Client Key (query) |
| GET | `/v2/point_inquiry/{token_id}` | Card point balance | Server |
| POST | `/v2/pay/account` | Link GoPay account (Tokenization) | Server |
| GET | `/v2/pay/account/{account_id}` | Linked account status & payment options | Server |
| POST | `/v2/pay/account/{account_id}/unbind` | Unlink GoPay account | Server |
| GET | `/v2/gopay/promo/{account_id}?gross_amount=&currency=` | Fetch GoPay promotions (production only) | Server |
| GET | `/v1/bins/{bin_number}` | BIN metadata | Client or Server |
| POST | `/v2/virtual-account/{va_number}/deactivate` | Deactivate a VA by number | Server |

Subscription endpoints live in `midtrans-core-subscription`.

## 1. Charge — `POST /v2/charge`
Body = `payment_type` + `transaction_details` + one method object (see `midtrans-core-json-objects` and the method skills). Response always includes `status_code`, `status_message`, `transaction_id`, `order_id`, `gross_amount` (string with .00), `payment_type`, `transaction_time`, `transaction_status`, `fraud_status`, plus method-specific data (VA number, `actions[]`, `redirect_url`, `payment_code`, `qr_string`…).

Typical `status_code`: `200` done/approved, `201` pending (needs customer action), `202` denied, `4xx/5xx` errors (see status-errors). Optional extras: `custom_expiry`, `custom_field1..3`, `metadata`.

Persist immediately: `order_id`, `transaction_id`, `transaction_status`, method data, `expiry_time`, raw response.

## 2. Get status — `GET /v2/{id}/status`
Same shape as the notification (includes `signature_key`). Fields worth reading:
`transaction_status`, `fraud_status`, `status_code`, `payment_type`, `gross_amount`, `masked_card`, `approval_code` (needed for card refunds), `bank`, `channel_response_code/message`, `card_type` (credit/debit), `payment_option_type` (GoPay: GOPAY_WALLET, PAY_LATER, GO_CICIL, GOPAY_COINS), `refund_amount`, `refunds[]`, point fields, `saved_token_id` + `saved_token_id_expired_at` (one-click), `expiry_time`, `shopeepay_reference_number`/`reference_id` (ShopeePay and QRIS-airpay), `merchant_cross_reference_id` (GoPay-QRIS flows), `payer_phone_number`/`merchant_invoice` (OVO).
Usage: reconciliation of pending orders, double-check before fulfilment, after timeouts, and (OVO) 10 s after the 65 s expiry.
For BI-SNAP/DANA transactions query by `transaction_id` only (not in this scope).

**Status B2B** — `GET /v2/{id}/status/b2b?page=0&per_page=10`: lists every transaction under an `order_id` (newest first; `page` is 0-based). Response `transactions[]` each with payment_type, bill_key, transaction_id, status, signature_key…

## 3. Capture — `POST /v2/capture`
Only for `transaction_status: authorize` (card pre-auth, or GoPay Tokenization `pre_auth`).
```json
{ "transaction_id": "be4f3e44-...", "gross_amount": 145000 }
```
`gross_amount` optional (default full). **GoPay does not accept partial capture.** Success: `200` "Success, Credit Card capture transaction is successful", status `capture`. Card pre-auth reservation lapses after 8 days (`expiry_time` of authorized txn) / about 7 days by default; GoPay pre-auth reservation lapses after 15 min unless custom expiry set.

## 4. Approve / Deny — `POST /v2/{id}/approve|deny`
Only when `fraud_status: challenge` (card). Approve → `capture/accept`. Deny → `deny/deny`. If you do nothing the txn is auto-cancelled at settlement (D+1 16:00). `412` if state doesn't allow.

## 5. Cancel — `POST /v2/{id}/cancel`
- Card not yet settled → void. Pre-authorized card cancel timing depends on acquirer: **BNI** after the pre-auth is captured; **Mandiri** after initial charge of the pre-auth; **BCA, BRI, Maybank** before and after capture.
- `pending` payments (VA, Mandiri Bill, direct debit, QRIS, GoPay, ShopeePay, Indomaret, Alfamart, Akulaku, Kredivo, CIMB VA) can be cancelled while not expired/paid.
- Settled → use refund instead.
- **Multi-use VA**: cancel works without `pending` state, on parent (first) or child `order_id`/`transaction_id`; only IDs **not older than 6 months**. After cancel you can recreate the same VA number if you use a custom VA number.
Success `200` "Success, transaction is canceled", `transaction_status: cancel`; cancel notification carries `status_code 202`. Error `412` "Merchant cannot modify the status of the transaction".

## 6. Expire — `POST /v2/{id}/expire`
Moves `pending` → `expire` (customer didn't pay). Response `status_code "407"` "Success, transaction has expired" (yes, 407 = success here). The expired `order_id` can be reused for the same/different payment method. `412` if not pending.

## 7. Refund — `POST /v2/{id}/refund`
For `settlement` transactions (use cancel for pending/authorize/capture). Midtrans forwards the request to the provider. Supported: `credit_card`, `gopay`, `shopeepay`, `dana`, `ovo`, `qris`, `kredivo`, `akulaku` (needs activation; request via Midtrans support). **Bank-transfer/VA, Mandiri Bill and OTC cannot be refunded via API.**
```json
{ "refund_key": "reference1", "amount": 5000, "reason": "customer request" }
```
- `refund_key` (opt, letters/digits/`-`/`_`): **always send it** — same key = safe retry (max 7 days after first attempt; after that use a new key); new key = new refund. Omitted → Midtrans generates one. Duplicate → `406 Duplicate refund ID`.
- `amount` (opt, Long): default whole amount. **ShopeePay and OVO: no partial refund.**
- `reason` (opt, String(255)): shown in the customer's GoPay history; **required for card refunds acquired by BNI** (auto-filled "refund request from merchant" if missing).
- Response: `status_code 200` "Success, refund request is approved", `transaction_status: refund` or `partial_refund`, `refund_chargeback_id`, `refund_amount`, `refund_key`. Errors: `412`, `414` (insufficient merchant balance / invalid amount), `406`.
- Max refund windows: ShopeePay (QRIS & JumpApp) 365 d · Kredivo 14 d · DANA 45 d · OVO 7 d (regular) / 180 d (OTA) · GoPay: QRIS on-us (GoPay acquirer × GoPay issuer) 45 d, QRIS off-us (other issuer) 7 d, GoPay Tokenization 180 d, GoPay deeplink 45 d, other GoPay 180 d.
- **GoPay static QRIS refund (since Jan 2024): must use `transaction_id`** in the path.
- Notification: two events; use the one with `bank_confirmed_at` as final confirmation.
- Retry the same `refund_key` for retriable errors (e.g. insufficient merchant balance — top up first).

### Direct refund — `POST /v2/{id}/refund/online/direct`
Same body. Sent directly to bank/provider; status updates immediately on provider result (standard refund can take 1–2 days). Supported: GoPay, QRIS, ShopeePay, credit card (acquirers **BCA, Maybank, BNI via Cybersource, BRI**), Akulaku, Kredivo. Windows: QRIS/airpay & ShopeePay 365 d (**no refunds 23:55–06:00 GMT+7**), Kredivo 14 d, QRIS GoPay acquirer 45 d, GoPay Tokenization & deeplink with `GOPAY_COINS` 90 d, other GoPay 180 d. Success message "Success, refund request is approved by the bank"; rejection returns `202` "Refund denied by the bank" with status unchanged (`settlement`) and `refund_amount "0.00"`. The doc now says the plain `/refund` endpoint is enough for all cases; direct remains for existing merchants.

## 8. Register card — `GET /v2/card/register`
Query: `card_number`, `card_exp_month`, `card_exp_year`, `client_key`, optional `callback` (JSONP). Returns `saved_token_id`, `transaction_id`, `masked_card`. Used for one/two-click (see card skill).

## 9. Point inquiry — `GET /v2/point_inquiry/{token_id}?gross_amount=`
`gross_amount` required for Mandiri point. Returns `point_balance_amount`. Get a **new** card token if you need to inquire before and after a charge.

## 10. BIN API — `GET /v1/bins/{bin}`
Auth with Client Key (safe for browser/mobile) or Server Key. Returns `data{ bin, bin_type (credit/debit), brand, bin_class, bank, bank_code, country_name, country_code, registration_required (deprecated)}`. Treat as **advisory** (UI/analytics), never strict validation (data changes without notice, can be empty). Rate limit 100/min → `409`; `404` unknown BIN; `401` bad credential.

## 11. Deactivate VA — `POST /v2/virtual-account/{va_number}/deactivate`
Body: `request_id` (10–50 chars, unique), `payment_type` (`bank_transfer`|`echannel`), `acquirer` (bank that issued VA, e.g. `BCA`), `reason`. Success `200` "Success, VA number is deactivated". Core API only. Use this to kill a stray VA number directly (vs cancel by order).

## 12. GoPay Tokenization endpoints
Detailed flow in `midtrans-core-ewallet` (references/gopay-tokenization.md).

## Implementation checklist
- [ ] Use `refund_key` + `Idempotency-Key` for refunds; store each refund row.
- [ ] Guard operations by state: don't call refund on non-settlement, capture on non-authorize.
- [ ] Cancel/expire a pending transaction before re-using customer's order for a different method (or create a new `order_id`).
- [ ] After any state-changing API call, still wait for the notification / re-GET status for the final truth.
- [ ] Handle `412`, `414`, `406` explicitly.
