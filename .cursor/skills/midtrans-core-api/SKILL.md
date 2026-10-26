---
name: midtrans-core-api
description: Entry point and router for implementing Midtrans Core API (custom checkout, NOT Snap) — charge, notifications, refund, card, VA, QRIS, GoPay, ShopeePay, OVO, OTC, Akulaku/Kredivo, subscription. Load this first whenever a task mentions Midtrans Core API, /v2/charge, payment_type, or building your own payment UI on Midtrans; it tells you which sub-skill to load next.
---

# Midtrans Core API — Router

Midtrans Core API is a REST/JSON API for **your own checkout UI**. Scope of this skill set: Core API only. **Not covered**: Snap, BI-SNAP, Payment Link, Invoicing, Partner API, MiniApp, Balance API. If the user wants a hosted checkout page, this is the wrong skill set (Snap is the product for that).

Source of truth: https://docs.midtrans.com/reference/core-api-overview (append `.md` to any docs URL for raw markdown). When a fact below is not enough or looks stale, fetch the matching docs page. Never invent fields.

## Step 1 — pick skills by task

| Task | Load |
|---|---|
| Any Core API work (always) | `midtrans-core-foundations` |
| Build request bodies (customer, items, expiry, per-method objects) | `midtrans-core-json-objects` |
| Webhook / payment notification endpoint | `midtrans-core-notifications` |
| Interpret `transaction_status`, `fraud_status`, `status_code`, channel response codes, deprecations | `midtrans-core-status-errors` |
| Charge/status/cancel/expire/refund/capture/approve/deny/BIN API | `midtrans-core-payment-api` |
| Credit/debit card (token, 3DS, installment, promo, pre-auth, one/two click, point, Full PAN) | `midtrans-core-card` |
| Google Pay | `midtrans-core-google-pay` |
| Virtual Account (BCA, BNI, BRI, Permata, CIMB), Mandiri Bill | `midtrans-core-bank-transfer` |
| QRIS, GoPay (deeplink/QR/tokenization), ShopeePay, OVO | `midtrans-core-ewallet` |
| Indomaret, Alfamart | `midtrans-core-otc` |
| Akulaku PayLater, Kredivo | `midtrans-core-cardless` |
| Recurring billing (card, GoPay) | `midtrans-core-subscription` |
| Sandbox testing, test cards, simulators, test phone numbers | `midtrans-core-sandbox-testing` |

Typical combos: **VA payment** = foundations + json-objects + bank-transfer + notifications + status-errors. **Card payment** = foundations + card + notifications. **Refund feature** = payment-api + notifications.

## Step 2 — universal rules (apply to EVERY Midtrans task)

1. **Server Key never leaves the backend.** Only the Client Key may be in browser/mobile code (card token, register card, BIN, Google Pay JWT).
2. **Auth**: `Authorization: Basic base64("<ServerKey>:")` — the trailing colon is mandatory. Sandbox and production keys differ.
3. **Base URLs**: sandbox `https://api.sandbox.midtrans.com`, production `https://api.midtrans.com`. Full-PAN / Google Pay charge uses `panapi.*` (see card / google-pay skills).
4. **Amounts**: integers in IDR, no decimals. `gross_amount` must equal the sum of `price × quantity` of `item_details` when items are sent.
5. **`order_id`**: unique per transaction, ≤50 chars, only letters, digits, `-` `_` `~` `.` (anything else is rejected). Duplicate → `406`.
6. **Never trust the browser redirect or the charge response alone for "paid".** Mark an order paid only from a **verified notification** (signature + status check) or a **GET status** call. See `midtrans-core-notifications`.
7. **Verify signature**: `SHA512(order_id + status_code + gross_amount + ServerKey)` — use the strings exactly as received (e.g. `"100000.00"`).
8. **Be idempotent.** Notifications can repeat or arrive out of order; use `order_id` as the key and never move a final status backwards.
9. **Treat `status_code` in the JSON body as authoritative**; the HTTP status of a Core API call can be 200 even for a business failure. Always parse `status_code` / `transaction_status`.
10. Request body max **16 KB**. Send `Content-Type: application/json` and `Accept: application/json`.
11. Use `Idempotency-Key` (UUID, ≤46 chars, lives 5 minutes) on retried POSTs (not on `/token`, `/account`).
12. Production Core API must be **activated by Midtrans** for the account; sandbox is active by default. Some methods (GoPay Tokenization, Akulaku, Kredivo, Full PAN, Google Pay, refund, direct refund, open-amount VA) also need activation. If you get `402`, the payment type is not enabled for the account.
13. Dates/times are GMT+7, format `yyyy-MM-dd HH:mm:ss` (some APIs add ` +0700`).
14. Parse JSON non-strictly: Midtrans adds fields without notice.

## Step 3 — implementation workflow

1. Confirm: which payment method(s), environment, backend language/framework, where orders are stored.
2. Load the skills from the table. Read their "Implementation checklist".
3. Implement in this order: HTTP client (auth) → charge → persist response (`transaction_id`, `order_id`, VA/QR/redirect data, `expiry_time`) → notification endpoint → status polling fallback → cancel/expire/refund.
4. Test in sandbox using `midtrans-core-sandbox-testing`. Test: success, pending→expire, deny, duplicate `order_id` (406), bad signature, duplicate notification.
5. Before go-live: production keys, notification URL (dashboard → Settings → Payment → Notification URL), HTTPS endpoint, Core API activation, method activation.

## What you must ask the user if unknown

- Which payment methods and which banks/wallets.
- Whether the merchant is PCI-DSS certified (needed for Full PAN; token-based card flow does not need it).
- Where Midtrans notification URL is set (dashboard setting, not code).
- Expected expiry per method and what the app should do on expire/deny.
