---
name: midtrans-core-ewallet
description: Midtrans Core API e-wallet and QR payments — QRIS (acquirer gopay or airpay shopee), GoPay (QR + deeplink), ShopeePay (JumpApp deeplink), OVO (push to phone, 65 s expiry), plus pointer to GoPay Tokenization. Request/response, actions, callbacks, expiry, notifications. Load for any e-wallet implementation.
---

# Midtrans Core API — E-Wallet & QRIS

Sources: /reference/payment-e-wallet, /qris, /gopay-1, /shopeepay-1, /ewallet-ovo, /faq-redirection-to-gojek-gopay-app. GoPay Tokenization (account linking, recurring) → `references/gopay-tokenization.md`.

Common: `201 pending` on charge → settlement/expire by notification. Possible errors 400, 401, 402, 406, 410. Refund supported via API (see payment-api for windows/limits). Cancel while pending allowed.

## Choose the method
| Need | Use |
|---|---|
| Desktop web: customer scans a QR with any QRIS app | `qris` (or `gopay` which returns QR + deeplink) |
| Mobile: open GoPay app | `gopay` → `deeplink-redirect` |
| Mobile: open Shopee app | `shopeepay` → `deeplink-redirect` |
| Customer types phone, approves in OVO app | `ovo` |
| Saved GoPay account / recurring | GoPay Tokenization |

## QRIS (`payment_type: "qris"`)
```json
{ "payment_type":"qris",
  "transaction_details":{"order_id":"order03","gross_amount":275000},
  "qris":{"acquirer":"gopay"} }          // or "airpay shopee"
```
- `qris.acquirer` optional (default `gopay`).
- Response `201`: `acquirer`, `merchant_id`, `actions[]`:
  - `generate-qr-code` — GET URL returning PNG QR **without** border.
  - `generate-qr-code-v2` — GET URL returning PNG QR with ASPI's border (use this where ASPI-style QR is required).
  - Render the image URL via `<img src>`; the GET needs no auth header when used as image URL from actions (don't embed the Server Key in the browser — if auth is required, proxy it server-side).
- Settlement notification adds `transaction_type` (`on-us`/`off-us`), `issuer`, `settlement_time`; ShopeePay-acquired adds `shopeepay_reference_number`, `reference_id`.
- Default expiry 15 min (min 20 s, max 7 days for GoPay acquirer; ShopeePay-acquirer max 5 days).
- Statuses: pending → settlement | expire | deny.

## GoPay (`payment_type: "gopay"`, non-tokenization)
```json
{ "payment_type":"gopay",
  "transaction_details":{"order_id":"order03","gross_amount":275000},
  "gopay":{"enable_callback":true,"callback_url":"someapps://callback"} }
```
- `gopay` object required (can be `{}`-like with the optional fields).
- Response `201` `actions[]`: `generate-qr-code`, `generate-qr-code-v2`, `deeplink-redirect` (GET `gojek://gopay/merchanttransfer?tref=...&amount=...&callback_url=...`), `get-status`, `cancel` (POST).
- **Desktop/tablet** → show QR (`generate-qr-code[-v2]`). **Mobile** → redirect to `deeplink-redirect` URL. Detect device server- or client-side.
- `enable_callback: true` appends `callback_url` to the deeplink so GoPay returns the user to your app (`someapps://callback?order_id=...`). Callback is only UX; trust the notification.
- Default expiry 15 min (min 20 s, max 7 days) via `custom_expiry`.
- Notification settlement includes `payment_option_type` (e.g. `GOPAY_WALLET`).
- Redirection note (from **1 April 2026**, gradual): users go to the **GoPay app** only; if not installed they see a web page asking to install it. Merchant must: support **universal-link format** redirection URLs; open redirection URL outside in-app WebView if possible (else whitelist `gopay.co.id/*`, `*.gopay.co.id/*`, `gojek.link/*` and keep older URLs); ensure the WebView doesn't block external-app redirects (Android/iOS).
- GoPay branding: follow media kit https://gopay.co.id/media-kit.
- Error `410` = GoPay user blocked.

## ShopeePay (`payment_type: "shopeepay"`)
```json
{ "payment_type":"shopeepay",
  "transaction_details":{"order_id":"test-order-shopeepay-001","gross_amount":25000},
  "shopeepay":{"callback_url":"https://shop.example/return"} }
```
- Response `201` includes `channel_response_code: "0"`, `merchant_id`, `actions[0] = deeplink-redirect` (universal link). Open it on mobile to go to Shopee app.
- `callback_url` may be a deeplink to your app (or set Finish URL in Dashboard › Settings › Payments).
- Default expiry 15 min, max 5 days (JumpApp & QRIS-airpay).
- Settlement notification has `shopeepay_reference_number`, `reference_id`, `settlement_time`.
- Refund: full only, up to 365 days (see payment-api).

## OVO (`payment_type: "ovo"`)
```json
{ "payment_type":"ovo",
  "transaction_details":{"order_id":"test-order-ovo-001","gross_amount":15000},
  "ovo":{"payer_phone_number":"081111111111"} }
```
Flow: show a phone-number input → charge → Midtrans pushes a request to the customer's OVO app → customer approves → notification.
- Response `201 pending`: `expiry_time` (fixed 65 s after creation), `payer_phone_number`, `fraud_status`.
- **No custom expiry.** Order expires after **65 s**; customer effectively has **55 s**. Tell the user (countdown on UI).
- **Call GET status ~10 s after expiry** to capture the final state (lag between OVO ↔ Midtrans ↔ you).
- Errors: `404 "User with requested phone number doesn't exist"` (body has `id`). Sandbox magic numbers → sandbox skill.
- Refund: full only (7 d regular / 180 d OTA).

## Shared handling snippet (Node)
```js
function nextAction(r) {
  const a = Object.fromEntries((r.actions||[]).map(x => [x.name, x.url]));
  return {
    qr: a['generate-qr-code-v2'] || a['generate-qr-code'],
    deeplink: a['deeplink-redirect'],
    verifyUrl: a['verification-link-url'], verifyApp: a['verification-link-app'], // tokenization
  };
}
```
Always branch on `status_code`/`transaction_status` first (e.g. tokenization `200` already settled).

## Checklist
- [ ] Device-aware UI (QR vs deeplink).
- [ ] Render QR from `actions`, don't build your own from `qr_string` unless you need to.
- [ ] Short expiry understood (OVO 65 s; GoPay/ShopeePay 15 min default).
- [ ] callback_url ≠ proof of payment; wait for notification/GET status.
- [ ] Refund path implemented per method rules.
