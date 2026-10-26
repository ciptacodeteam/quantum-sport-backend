---
name: midtrans-core-google-pay
description: Midtrans Core API Google Pay — generate JWT via panapi google_auth, render Google Pay button with gateway midtrans, send charge with credit_card.google_pay_token to panapi, sandbox test rules. Load for Google Pay (card via Google wallet) on Midtrans Core API.
---

# Midtrans Core API — Google Pay™

Source: /reference/payment-method-google-pay. Only **card** payments through Google Pay are available in Indonesia. Networks: VISA, MASTERCARD, JCB, AMEX (AMEX needs enablement via Midtrans). Midtrans sends real-time notification.

Uses the dedicated **panapi** domain (separate from normal Core API):

| Env | JWT API | Charge API | Post-charge (status/cancel/refund) |
|---|---|---|---|
| Sandbox | `https://panapi.sandbox.midtrans.com/google_auth` | `https://panapi.sandbox.midtrans.com/v2/charge` | `https://api.sandbox.midtrans.com` |
| Production | `https://panapi.midtrans.com/google_auth` | `https://panapi.midtrans.com/v2/charge` | `https://api.midtrans.com` |

A JWT from one environment is invalid in the other; each environment accepts only its own Client Key.

## Steps

### 1. Generate JWT (sandbox may skip)
```bash
curl 'https://panapi.midtrans.com/google_auth' \
  -H 'Accept: application/json' \
  -H 'Authorization: Basic '$(echo -n "<MERCHANT_CLIENT_KEY>:" | base64) \
  --data-raw '{"merchantOrigin":"shop.example.com"}'     # your checkout page domain
# -> { "authJwt": "<ES256 JWT>" }
```
Authorization uses the **Client Key** (base64 of `clientKey:`). `merchantOrigin` = origin of the page showing the button. Not required in sandbox.

### 2. Google Pay button
Follow Google's web tutorial (`PaymentsClient`, `isReadyToPay`, `loadPaymentData`) with:
- `tokenizationSpecification.type = "PAYMENT_GATEWAY"`, `parameters.gateway = "midtrans"`, `parameters.gatewayMerchantId = "BCR2DN4T2PNOHCSD"`.
- Allowed card networks: `VISA`, `MASTERCARD`, `JCB`, `AMEX`.
- Use the `authJwt` as the Google Pay API JWT (partner/web-platform flow, no per-domain registration).
The `PaymentData.paymentMethodData.tokenizationData.token` (JSON) is what you send to your backend.

### 3. Charge (backend → panapi)
```json
POST https://panapi.midtrans.com/v2/charge
{
  "payment_type": "credit_card",
  "transaction_details": { "order_id": "C17550", "gross_amount": 145000 },
  "credit_card": {
    "google_pay_token": { "protocolVersion":"ECv2", "signature":"...", "intermediateSigningKey":{...}, "signedMessage":"..." },
    "authentication": true
  }
}
```
- Pass the token **object** parsed from Google's response as `google_pay_token` (instead of `token_id`).
- `authentication: true` enables 3DS (recommended). Response and notifications are identical to normal card charge (`201 pending` + `redirect_url` when 3DS; see `midtrans-core-card`).
- Auth header: Server Key Basic auth as always.

## Sandbox
- Join Google's test group (googlepay-test-mode-stub-data) with the Google account used for checkout; test cards then appear in the wallet. They don't appear in production.
- Google returns card `4111111111111111` on the test environment.
- Amount controls the result in Midtrans sandbox: **IDR 10,002 or 10,004 → accepted**; **10,001 or 10,003 → denied**; any other amount → denied with unknown card error.

## Checklist
- [ ] Charge goes to panapi, follow-up calls to api.
- [ ] JWT per environment, Client Key only for JWT.
- [ ] Notification URL handling identical to card.
- [ ] Do not log Google token payloads.
