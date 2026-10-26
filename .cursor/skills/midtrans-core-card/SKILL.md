---
name: midtrans-core-card
description: Midtrans Core API credit/debit card payments — client-side card token (midtrans-new-3ds.min.js), charge with token_id, 3D Secure 2.0 (authentication:true, redirect_url, js_event/form callbacks), installment, BIN promo, pre-authorization + capture, one-click/two-click, CIT/MIT recurring, point redemption, route to channel, Full PAN (PCI). Load for any card payment implementation.
---

# Midtrans Core API — Card Payment

Sources: /reference/payment-card, /get-token, /charge-transactions-on-card, /card-feature-* pages, /faq-3d-secure-20-emv-3ds.
Networks: Visa, MasterCard, JCB, Amex, China UnionPay (not all acquirers support JCB/Amex/CUP — needs activation). Both credit and debit cards use `payment_type: "credit_card"`.

## Flow (token-based, no PCI scope on your server)

1. **Browser/app** loads Midtrans JS and exchanges card data for `token_id` (Client Key).
2. **Backend** calls `POST /v2/charge` with `token_id` and `authentication: true`.
3. If response has `redirect_url` (`status_code 201`, status `pending`) → customer completes 3DS OTP.
4. Final result via **notification** (and GET status). 3DS 2.0 challenge is **asynchronous**: after OTP the txn may still be `pending`.
5. Fulfil only on verified `capture`+`accept` / `settlement` (see notifications skill).

Never send card numbers through your server in this flow (that is Full PAN → PCI-DSS only).

## 1. Get card token (client side)

```html
<script id="midtrans-script" type="text/javascript"
  src="https://api.midtrans.com/v2/assets/js/midtrans-new-3ds.min.js"
  data-environment="sandbox"            <!-- or production -->
  data-client-key="YOUR_CLIENT_KEY"></script>
```
```js
const card = { card_number: "4811111111111114", card_cvv: "123", card_exp_month: "12", card_exp_year: "2030" };
MidtransNew3ds.getCardToken(card, {
  onSuccess: (r) => { /* r.token_id -> send to backend */ },
  onFailure: (r) => { /* r.status_code 400, r.validation_messages */ }
});
```
- `card_number` 16 digits (spaces allowed), `card_cvv`, `card_exp_month` (MM), `card_exp_year` (YYYY).
- Two-click token request: `token_id` = previously saved `saved_token_id` + `card_cvv` (card number/expiry not needed).
- KKI (Kartu Kredit Indonesia) cards: card_number = CPAN, plus `bank_one_time_token` (OTT shown in mobile banking).
- **Do not send `secure:true`** — ignored/deprecated; 3DS is selected at charge time.
- Response: `status_code "200"`, `token_id` (format `48111111-1114-<36 random>`, 8-digit BIN), `hash` (stable one-way hash of the card number — usable for duplicate-card detection). 400 → `validation_messages` (e.g. expiry in the past).
- Token is single use & short-lived; charging with an old/used token → `411`.

## 2. Charge

```json
POST /v2/charge
{
  "payment_type": "credit_card",
  "transaction_details": { "order_id": "C17550", "gross_amount": 145000 },
  "credit_card": { "token_id": "48111111-1114-....", "authentication": true },
  "item_details": [...], "customer_details": {...}
}
```
Sending `item_details`, `customer_details`, billing & shipping address improves 3DS 2.0 **frictionless** approval (issuer decides; more data = fewer declines).

Responses (examples of key fields): `status_code`, `transaction_status` (`capture`|`authorize`|`pending`|`deny`), `fraud_status`, `masked_card` (8+4 digits), `bank` (acquirer), `approval_code` (use for refund; absent on deny), `channel_response_code/message`, `card_type`, `on_us` (issuer==acquirer), `channel`, `eci`, `three_ds_version`, `three_ds_challenge_completion`, `redirect_url`, `expiry_time` (regular txn / 3DS redirect_url: 10 min; authorized: 8 days), `settlement_time`.

| Outcome | How it looks |
|---|---|
| Success (non-3DS or frictionless) | `200`, `capture`, `accept`. |
| Need 3DS | `201`, `pending`, `redirect_url`. |
| Denied | `202`, `deny` (`fraud_status` accept = bank denied; deny = FDS). |
| Challenge | `201`, `capture`, `fraud_status: challenge` → approve/deny. |

Capture → `settlement` happens next day 16:00 (cut-off 00:00–23:59 settles D+1 16:00).

## 3. 3D Secure 2.0 (always on)

Request: `credit_card.authentication: true`; optional `callback_type: "js_event"` (default; open 3DS in your iframe) or `"form"` (full-page redirect, POST back).

**Option A — redirect**
```js
MidtransNew3ds.redirect(redirect_url, { callbackUrl: "https://shop.example/3ds-done" });
```
After OTP the customer is POSTed to `callbackUrl` (or dashboard *Finish Redirect URL*) with form field `response` = JSON string (status, masked_card, three_ds_version, three_ds_challenge_completion …).

**Option B — iframe (js_event)**
```js
MidtransNew3ds.authenticate(redirect_url, {
  performAuthentication: (url) => openIframeModal(url),   // you implement
  onSuccess: (r) => { closeModal(); },
  onFailure: (r) => { closeModal(); },
  onPending: (r) => { /* final status comes via HTTP notification */ }
});
```
Rules:
- Treat callback/redirect results as **UX only**. If status is `pending`, wait for notification or poll GET status for ~1–2 minutes (3DS 2.0 is async).
- **Do not alter `BrowserInfo`** that Midtrans' redirect page gathers (user agent, IP, screen size, language, TZ…; forwarded Base64 to the 3DS server). Do not rename or edit it. VPN use by the customer can cause rejection (browserIP mismatch).
- If you close the OTP page by URL path validation, update the paths to 3DS 2.0: redirect `/v2/3ds/redirect/{tokenId}`, completion `/v2/3ds/result-completion/{tokenId}` (3DS1 used `/v2/token/rba/redirect|callback/{tokenId}`).
- 3DS 1.0 is not supported; a txn still routed to 3DS1 usually means: issuer/acquirer lacks 3DS2, gateway timeout fallback, or the old token flow (`secure` param) is still in use. Fix: token without `secure`, charge with `authentication:true`.
- Mobile apps: use Midtrans Mobile SDK UI kit, or WebView over Snap / web Core API flow to avoid "stuck on OTP page".
- Callbacks fields include `three_ds_challenge_completion` (true once the customer submitted OTP — valid or not).

## 4. Features (all use the same `/v2/charge`; extra fields in `credit_card`)

### Installment
- **Online** (acquirer == issuer): `{"token_id","bank":"bni","installment_term":6}`. Result `capture`. Debit cards unsupported; non-H2H channels unsupported.
- **Offline** (acquirer ≠ issuer): add `bins:[...]` to restrict eligible cards; `bank` = acquirer.

### BIN promo
`{"token_id","bank":"bni","bins":["48111111","bni","5"]}` — each entry is a BIN prefix, issuing-bank name, or leading digit(s) (e.g. `5` = Mastercard). Only matching cards are accepted. Result `capture`.

### Pre-authorization + capture
`{"token_id","type":"authorize"}` → `transaction_status: authorize`. Funds blocked (default released after ~7 days; authorized `expiry_time` 8 days). Settle with `POST /v2/capture` {`transaction_id`,[`gross_amount`]}. If capture fails at the bank: capture response `deny` while latest status stays `authorize`. Cancel allowed per acquirer rules (see payment-api). Works with Full PAN too.

### One-click and two-clicks (saved cards)
1. First charge with `"save_token_id": true` → response/notification contains `saved_token_id` and `saved_token_id_expired_at` (store per customer; treat as secret).
2. **One click**: next charge `credit_card.token_id = saved_token_id` (no CVV, no JS token).
3. **Two clicks**: client calls `getCardToken({token_id: saved_token_id, card_cvv})` → new `token_id` → normal charge.
4. Alternative registration without a payment: `GET /v2/card/register` (client key) → `saved_token_id`.
5. Requires email notification enabled in dashboard General Settings; also required for subscription.
**CIT / MIT** (higher approval for recurring on saved card):
```json
"credit_card": { "token_id": "<saved_token_id>", "authentication": false, "initiated_by": "customer" }   // CIT (default)
"credit_card": { "token_id": "<saved_token_id>", "initiated_by": "merchant" }                              // MIT
```
CIT = customer actively pays (may use 3DS: `authentication:true`). MIT = merchant-triggered recurring/post-purchase, no cardholder present.

### Point redemption (BNI, Mandiri only)
1. `GET /v2/point_inquiry/{token_id}?gross_amount=…` → `point_balance_amount`.
2. Charge: `{"token_id","bank":"bni","point_redeem_amount":50000}`; `-1` = redeem all. Mandiri = full redemption only; BNI partial allowed (< balance).
3. Response adds `point_redeem_amount`, `point_redeem_quantity`, `point_balance_amount`. Use a fresh token to inquire again.

### Route to channel
`credit_card.channel`: `dragon`, `mti`, `migs`, `cybersource`, `braintree`, `mpgs`. Omitted → priority DRAGON > MTI > MIGS > CYBERSOURCE > BRAINTREE > MPGS. If no MID exists on the requested channel, any other available channel is used. For MIGS banks you must send `bank`. Need exact bank+channel pairing → contact Midtrans support.

### Full PAN (PCI-DSS merchants only)
Skips tokenization. Charge goes to **`https://panapi.sandbox.midtrans.com/v2/charge`** / **`https://panapi.midtrans.com/v2/charge`** (never send `token_id` to panapi; never send PAN to the normal domain). Status/cancel/refund still use `api.*`.
```json
"credit_card": {
  "card": { "number": "4811111111111114", "expiry_month": "03", "expiry_year": "2030", "cvv": "123" },
  "authentication": true,
  "dynamic_descriptor": { "merchant_name": "SHOP*PRODUCT", "city_name": "Jakarta", "country_code": "ID" }
}
```
- Omitting `card.cvv` makes the transaction a **recurring** (MIT-style) transaction.
- `dynamic_descriptor` (BNI only): `merchant_name` ≤25 (statement first 25 chars), `city_name` ≤13, `country_code` 2 chars.
- 3DS and non-3DS identical flow to token-based. You carry PCI-DSS obligations: never log/store PAN/CVV.

## 5. Card state machine (cheat sheet)
`charge → [pending (3DS)] → capture(accept) → settlement → refund/partial_refund/chargeback`
`charge(type=authorize) → authorize → capture → capture → settlement` (or `cancel`)
`capture(challenge) → approve → capture(accept)` or `deny`.

## 6. Checklist
- [ ] Client Key in browser only; Server Key in backend only.
- [ ] `authentication: true` on every charge; no `secure` param.
- [ ] Handle 201/pending + redirect_url; wait for notification (async 3DS2).
- [ ] Store `approval_code`, `masked_card`, `bank`, `saved_token_id` (if one-click).
- [ ] Handle fraud `challenge` (approve/deny) or document that FDS is configured to avoid it.
- [ ] Tokens are single-use: on `411` re-tokenize.
- [ ] Test with sandbox cards (see sandbox skill): frictionless, challenge, deny, pending→accept after 60 s.
