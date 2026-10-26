---
name: midtrans-core-status-errors
description: Midtrans Core API status reference — transaction_status values and transitions, fraud_status, Midtrans status codes 2xx/3xx/4xx/5xx, channel_response_code (card, GoPay, ShopeePay), error handling playbook and deprecation notices. Load when interpreting a Midtrans response/notification or writing error handling.
---

# Midtrans Core API — Statuses, Codes, Errors, Deprecations

Sources: /reference/transaction-status, /fraud-status, /code-2xx…5xx, /channel-response(-code), /gopay-response-codes, /shopeepay-response-codes, /deprecation.

## 1. `transaction_status`

| Status | Meaning | May change to |
|---|---|---|
| `authorize` | Card authorized (pre-auth); needs capture. Card only. | capture, cancel |
| `capture` | Card charged; auto-settles within 24 h / agreed settlement time. Safe to treat as successful (if fraud_status accept). | settlement, cancel |
| `settlement` | Settled; funds credited. | refund, partial_refund, chargeback, partial_chargeback |
| `deny` | Rejected by provider or Midtrans FDS (see `status_message`). Final. | – |
| `pending` | Created, waiting for customer to pay (VA, e-wallet, OTC…). | settlement, deny, cancel, expire |
| `cancel` | Cancelled by Midtrans/bank/you (card pre-auth past capture time is cancelled by Midtrans). Final. | – |
| `refund` | Fully refunded (merchant-triggered). | – |
| `partial_refund` | Partially refunded. | refund |
| `chargeback` | Charged back (card only). | – |
| `partial_chargeback` | Partially charged back. | chargeback |
| `expire` | Not paid in time. Final; `order_id` may be reused. | – |
| `failure` | Unexpected processing error. Final; verify with GET status. | – |

Note: some payloads (DANA/ShopeePay B2B-style status) return upper-case such as `PENDING`; normalise with `.toLowerCase()`.

## 2. `fraud_status`
`accept` safe · `challenge` (card only) FDS wants manual review → call Approve or Deny, otherwise auto-cancelled at settlement (D+1 16:00) · `deny` fraud, rejected.

## 3. Midtrans `status_code` (in body)

**2xx**
- `200` Success. Card: authorize/capture/settlement/cancel; challenge approval accepted. Others: settlement or cancel.
- `201` Pending. Card: 3DS not finished yet (expires in ~15 min) *or* rare FDS challenge (not approved by D+1 16:00 → cancelled). Bank transfer: awaiting payment (default 24 h). GoPay: awaiting (default 15 min). CIMB Clicks: awaiting.
- `202` Denied (card: bank/FDS; others: provider). Also used in cancel/expire notifications.

**3xx**: `300` moved permanently — use new URL.

**4xx**
| Code | Meaning / action |
|---|---|
| 400 | Validation error — read `validation_messages`. |
| 401 | Unauthorized — wrong/missing Server Key or Client Key, or wrong environment. |
| 402 | Payment type not enabled for the account. |
| 403 | Resource cannot generate the content type requested (check Accept header). |
| 404 | Transaction/resource not found (check `order_id`). |
| 405 | HTTP method not allowed. |
| 406 | **Duplicate `order_id`**. Also "Duplicate refund ID". Use a new order_id (or reuse only after expire). |
| 407 | Expired transaction. (Expire API success also returns 407 "Success, transaction has expired".) |
| 408 | Wrong data type. |
| 410 | GoPay user is blocked. |
| 411 | `token_id` missing, invalid, or timed out (get a new card token). |
| 412 | Transaction status cannot be updated (e.g. cancel after settlement, refund before settlement, wrong state). |
| 413 | Syntax error in request body (malformed JSON). |
| 414 | Refund rejected: insufficient merchant funds / invalid amount. |
| 429 | API rate limit exceeded. |

**5xx**: 500 internal error · 501 feature not available · 502 bank connection problem · 503 bank/partner connection issue · 504 FDS unavailable · 505 failed to create VA number, retry later.

## 4. Error-handling playbook

| Situation | Do |
|---|---|
| 400 | Fix payload; never retry unchanged. |
| 401 | Check key ↔ environment pairing and Basic-auth colon. |
| 402 | Payment method not activated → ask Midtrans/sales PIC. |
| 406 | Generate a fresh `order_id` (keep a retry counter suffix: `ORD-1001-2`). |
| 407/expire | Create a new transaction (can reuse `order_id`). |
| 411 | Re-tokenize card on client. |
| 412 | GET status; the state doesn't allow the operation. |
| 429 | Exponential backoff + jitter. |
| 500/502/503/504 | Retry with the **same Idempotency-Key**; if still failing, GET status before creating anything new; surface "try again" to user. |
| Network timeout on charge | Never assume failure. GET status by `order_id`; 404 means not created. |
| `deny` on card | Show generic failure, offer another method; check `channel_response_code`. |

## 5. `channel_response_code` / `channel_response_message`
Returned for card, GoPay, ShopeePay, OVO, Akulaku/Kredivo etc. Use for logs and user-facing hints; **do not branch business logic on message text**.

**Card (common across VISA/MC/JCB/AMEX)** — key codes: `00` approved · `01/02/05/06/07/09/21/25` issuer problem with card (use another card/contact bank; `04/07` card to be retained: lost/stolen) · `03` invalid Merchant ID · `12` invalid format · `13` invalid character/amount (sandbox) · `14` card number doesn't exist · `15` issuer doesn't exist · `19` retry · `22` issuer unreachable · `23` unspecified error · `30` transaction details not recognised · `51` insufficient funds · also `41` card reported lost · `54` card expired · `61` exceeds card limit · `91` issuer unreachable, retry · (`05` is "Do not honor"-type decline: security check failed/funds frozen). Network-specific extra tables exist for VISA, MASTERCARD, AMEX, and Midtrans (`E9` generic error when bank response empty). Full list: https://docs.midtrans.com/reference/channel-response-code (bank-/network-specific tables for MPGS, etc.; MPGS replaced MIGS for BCA/BRI MIDs, which changes the code/message format).

**GoPay** (selected): `200` success · `201` insufficient balance · `900` generic/intermittent service error, retry later · `2903` INVALID_REQUEST (most common cause: callback/redirect URL not whitelisted) · `1001` "Caller authentication error" seen in an unbind-denied sample · many `1xx` are internal/system errors (e.g. 112 wallet blocked, 119 incorrect PIN, 125 PIN required, 132 transaction in progress). Midtrans-specific extras in the card table also reuse some numbers (110 unauthorized, 156 payment method disabled, 159 invalid payment option token, 201 not enough balance, 213 monthly wallet limit exceeded). Full list: /reference/gopay-response-codes.

**ShopeePay**: `0` success · `-2` connection dropped · `-1` server error · `1` request parameter error · `2` permission denied · `4` merchant/store not found · `6` wallet not activated · `7` expired · `9` account banned · `11` duplicate request · `24` account frozen · `42` insufficient balance · `101–104` wallet/daily limits · `105` invalid authorization code · `121` update on completed transaction · `301` invalid payment code/QR · `303` merchant paying own account · `304` refund/void outside validity (default 24 h). Full list: /reference/shopeepay-response-codes.

**OVO** (sandbox magic numbers; see sandbox skill): RC `14` number not registered · `17` user cancelled · `26` push to OVO app failed · `40` payment failed · `68` pending/timeout.

## 6. Deprecations and gotchas (still enforced)

- **3DS 1.0 is gone.** `secure:true/false` on token creation is ignored (since Sep 2023). Create the token **without** `secure`, and send `credit_card.authentication: true` on charge, otherwise it is treated as non-3DS. 3DS1-only cards are denied at `/charge` (since Feb 2023).
- **`channel` parameter** on token/charge: only send `bank` for MIGS banks; `channel` is optional now (routing by priority).
- **`order_id` charset** restricted to `- _ ~ .` + alphanumerics (since Nov 2017). Midtrans sanitises order IDs for MPGS, so bank/MPGS reports may show a different string than MAP.
- **`gross_amount` decimals** forbidden (Jan 2017): `"10000"`, `10000`, `"10000.00"` valid; `"10000.01"` invalid → 400.
- **Mandiri ClickPay** must use `token_id`, not raw card number.
- `veritrans.co.id` hosts are retired → use `api.midtrans.com`, `app.midtrans.com`, `payments.midtrans.com`.
- Notification `User-Agent` is no longer "Veritrans" — don't rely on it.
- 8-digit BIN: `token_id` format is `8 first digits - 4 last digits - 36 random`; `saved_token_id` is `8 first + 20 random + 4 last`; `masked_card` shows 8+4 digits. Don't hard-code 6-digit assumptions.
- GoPay action `user-verification` and Tokenization `activation-deeplink` are deprecated → use `verification-link-url/app` and `activation-link-url/app`.
