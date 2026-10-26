# GoPay Tokenization (Core API) — reference

Sources: /reference/gopay-tokenization, /create-pay-account, /get-pay-account, /unbind-pay-account, /testing-gopay-tokenization-on-sandbox-environment, /faq-redirection-to-*.
Activation required (Midtrans support / sales PIC) for both sandbox and production. Recommended for recurring payments. Not "one-time"—a linked account pays later without re-entering the number.

## Two verification modes
1. **Web flow** — linking & payment verified on GoPay web (OTP/PIN). Use `verification-link-url`. Web URLs are **single-use** (re-initiate to get a new one).
2. **App redirection flow** — verification in Gojek/GoPay app. `verification-link-url` for desktop (QR + push notification to the Gojek app, auto-redirect back); `verification-link-app` for mobile app/browser (opens app). App URLs reusable until expiry. Links expire in **5 minutes**.
Don't hardcode/whitelist exact GoPay URLs (they change); whitelist domains only if you must (see ewallet skill).

## Flow
1. **Link** (only if not linked yet): `POST /v2/pay/account`
```json
{ "payment_type":"gopay",
  "gopay_partner":{ "phone_number":"81212345678","country_code":"62","redirect_url":"https://shop.example/linked" } }
```
`phone_number` without leading 0 / country code. Response `201`: `account_id`, `account_status: "PENDING"`, `actions[]` = `activation-link-url`, `activation-link-app` (use one; `activation-deeplink` deprecated). Failure example: `202` + `channel_response_code 2903` "invalid scheme" (typical cause: redirect/callback URL not whitelisted/onboarded). Sandbox failure numbers: `123450001` not registered, `123450002` blocked (old sandbox).
2. Customer verifies. Midtrans sends **Pay Account notification** (`account_status ENABLED`, `status_code 200`) → verify signature `SHA512(account_id+account_status+status_code+ServerKey)`.
3. **Fetch**: `GET /v2/pay/account/{account_id}` — do this after the notification, as fallback if no notification arrived, and **before every payment** (tokens can change, e.g. upgrade to GoPay Tabungan).
   - Statuses: `PENDING` (201), `EXPIRED` (204), `ENABLED` (200), `DISABLED` (204).
   - `metadata.payment_options[]`: `{name: GOPAY_WALLET|PAY_LATER|…, active, balance{value,currency}, token}`; the `token` is the `payment_option_token` for charge. Let the customer choose a payment option.
4. **Charge**: `POST /v2/charge`
```json
{ "payment_type":"gopay",
  "gopay":{ "account_id":"…","payment_option_token":"…","callback_url":"https://shop.example/paid",
            "recurring":false, "promotion_ids":["CASHBACK|…"] },
  "transaction_details":{"order_id":"order-1234","gross_amount":100000},
  "payment_provider_metadata":{"recurring_parent_order":"parent-order","recurring_sequence":"1"} }
```
   - `200` + `settlement` → paid (no-PIN). `201` + `pending` → open `verification-link-url` / `verification-link-app` from `actions` (PIN challenge), result by notification. `202 deny` (+ `channel_response_code 201` = insufficient balance).
   - `callback_url` must equal the URL given at onboarding (whitelisted); default = dashboard Finish URL (also whitelisted).
   - `payment_provider_metadata` conditional — only when your sales rep says so. `recurring_sequence`: `"0"` parent, `"1"`… children.
   - `recurring:true` = no PIN challenge, only for authorized merchants.
   - `promotion_ids`: from Fetch Promotion API (`GET /v2/gopay/promo/{account_id}?gross_amount=&currency=`, production only); first ID used.
5. **Unlink**: `POST /v2/pay/account/{account_id}/unbind` → `204 DISABLED`. Offer an unlink entry point in your UI. Denied example: `202`, channel code `1001` "Caller authentication error".
6. **Listen** for unbind notifications (`204 DISABLED`) — also sent when the user unlinks in the Gojek/GoPay app or changes phone number/PIN.

## Pre-authorization (tokenization only)
Charge with `gopay.pre_auth: true` → `200`, `transaction_status: authorize` (balance reserved). Then `POST /v2/capture` {`transaction_id`, `gross_amount`} (**no partial capture**) or cancel `POST /v2/{id}/cancel`. Only non-PIN flow is supported; in sandbox keep amount < IDR 100,000. Reserved balance auto-released after the default period.

## Notification types you will see
pending(201) · settlement(200, has `payment_option_type`) · deny(202) · expire(202) · cancel(202) · refund(200, with `refunds[]`, `refund_amount`).

## Sandbox (new sandbox, rolled out 22 Oct 2024)
- Base `https://api.sandbox.midtrans.com`; same MID and Server Key as old sandbox (kept different from production). Make sure merchant phone & email are filled (Dashboard › sandbox › Settings › General).
- PIN **112233**, OTP **987654**.
- Amount **< IDR 100,000 → no PIN**; **≥ 100,000 → PIN**.
- Test phone numbers: `+628215023424`, `+628242974268` (happy, GoPay Saldo) · `+628271939753` (blocked) · `+628242014881` (insufficient balance) · `+628237435829` (promotion available) · `+628103001242` (GoPay Later happy) · `+380441234567/68`, `+918877661234/35` (happy) · any random number = not registered → GoPay shows account-creation flow in linking webview.
- Linkings from the old sandbox don't work; re-link. User balances are shared universally across merchants in this sandbox.
- Don't use real money.
