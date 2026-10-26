---
name: midtrans-core-json-objects
description: Midtrans Core API JSON request/response object reference — transaction_details, customer_details, item_details, seller_details, custom_expiry, custom fields, metadata, credit_card, gopay, shopeepay, ovo, qris, bank_transfer, echannel, cstore, va_numbers, actions, payment amount. Load when building or validating a Midtrans charge request body.
---

# Midtrans Core API — JSON Objects

Source: docs.midtrans.com/reference/*-object. Types: `String(n)` = max n chars. "Req" = Required, "Opt" = Optional, "Cond" = Conditional.

## Base charge skeleton

```json
{
  "payment_type": "<credit_card|bank_transfer|echannel|gopay|shopeepay|ovo|qris|cstore|akulaku|kredivo>",
  "transaction_details": { "order_id": "ORD-1001", "gross_amount": 145000 },
  "item_details": [ { "id": "a1", "price": 145000, "quantity": 1, "name": "Apel" } ],
  "customer_details": { "first_name": "Budi", "last_name": "Utomo", "email": "budi@example.com", "phone": "081234567890" },
  "<method_object>": { }
}
```
`<method_object>` is one of `credit_card`, `bank_transfer`, `echannel`, `gopay`, `shopeepay`, `ovo`, `qris`, `cstore` (see sections below). Optional extras: `custom_expiry`, `custom_field1..3`, `metadata`.

## transaction_details
| Field | Type | Req | Rule |
|---|---|---|---|
| `order_id` | String(50) | Req | Allowed symbols: `-` `_` `~` `.` plus letters/digits. Anything else → request declined. |
| `gross_amount` | Long | Req | IDR, **no decimals** (`145000`, not `145000.50`). |

## item_details (array)
| Field | Type | Req | Note |
|---|---|---|---|
| `id` | String | Opt | Akulaku: required and **must be unique per request**. |
| `price` | Integer | Req | IDR, no decimal. |
| `quantity` | Integer | Req | |
| `name` | String | Req | Alfamart: avoid the `|` character. |
| `brand`, `category`, `merchant_name`, `url` | String | Opt | Kredivo expects category & url. |
| `tenor`(2 digits), `code_plan`(3), `mid`(9) | Integer | Cond | **BCA KlikPay installment only.** |

Rule: `Σ(price × quantity)` over all items **must equal `gross_amount`** exactly. Shipping, tax, discount → send as extra items (discount as negative price) so totals match. Item details are required for Akulaku.

## customer_details
`first_name`, `last_name`, `email`, `phone` (all String(255), Opt), `billing_address`, `shipping_address`.
Address fields (all Opt): `first_name`, `last_name`, `phone`, `address`, `city`, `postal_code` (letters, digits, `-`, space), `country_code` (String(3); only `IDN` supported).

Bank-specific limits:
- **BCA VA**: `first_name`+`last_name` limited to 30 chars.
- **BNI VA**: phone must start with `+62` or `0`+area code, max 30 chars, else rejected.

## seller_details (marketplace; Kredivo requires for marketplace merchants)
`id`, `name`, `email`, `url`, `address{first_name,last_name,phone,address,city,postal_code,country_code}`. All String(255), Opt (Kredivo sample shows them all filled; Kredivo docs: "required for marketplace merchant"). In the Kredivo sample `seller_details` is sent as an array.

## custom_expiry
```json
"custom_expiry": { "order_time": "2016-12-07 11:54:12 +0700", "expiry_duration": 60, "unit": "minute" }
```
- `order_time` (String): when the order was created, ISO-8601, GMT+7. If omitted, expiry counts from transaction time.
- `expiry_duration`: number. `unit`: `second` | `minute` (default) | `hour` | `day`.
- Applies to pending-type methods: VA/Mandiri Bill, direct debit (KlikBCA, BCA KlikPay, BRImo, CIMB Clicks, Danamon, UOB Ezpay), QRIS, GoPay, ShopeePay, Indomaret, Alfamart, Akulaku, Kredivo.
- Exceeding the allowed maximum → rejected. Defaults/limits: bank transfer/VA & OTC default 24 h (min 20 s, max 180 days); GoPay/QRIS(gopay) default 15 min (max 7 days); QRIS airpay-shopee & ShopeePay default 15 min (max 5 days); Akulaku default 2 h; Kredivo default 24 h; **OVO: not customizable (fixed 65 s)**.

## Custom fields and metadata
- `custom_field1/2/3` (String(255)) — labels set in MAP (*Settings → General Settings → Interface Settings*); echoed in status & notification.
- `metadata` — free-form JSON object tag; returned by GET status and notification; usable in fraud rules.

## credit_card object
| Field | Type | Req | Meaning |
|---|---|---|---|
| `token_id` | String(255) | Req | Card token from `/v2/token` (or `saved_token_id` for one-click). Google Pay uses `google_pay_token` instead. |
| `bank` | String | Opt | Acquirer: `mandiri`,`bni`,`cimb`,`bca`,`maybank`,`bri`. Required for installment/point/MIGS banks. |
| `installment_term` | Integer | Opt | Months. |
| `bins` | Array | Opt | Allowed BIN prefixes/bank names/brand digit for promo (e.g. `["48111111","bni","5"]`). |
| `type` | String | Opt | `"authorize"` = pre-authorization. |
| `save_token_id` | Boolean | Opt | One/two-click: return `saved_token_id`. |
| `channel` | String | Opt | `dragon`,`mti`,`migs`,`cybersource`,`braintree`,`mpgs`. Default routing priority: dragon > mti > migs > cybersource > braintree > mpgs. |
| `authentication` | Boolean | Opt | `true` enables 3DS (default false). **Always send true.** |
| `callback_type` | String | Opt | 3DS callback: `js_event` (default) or `form`. |
| `initiated_by` | String | Opt | `customer` (default) or `merchant` (MIT). |
| `point_redeem_amount` | Long | Opt | Point redemption (BNI, Mandiri). |
Full detail → `midtrans-core-card`.

## bank_transfer object
| Field | Notes |
|---|---|
| `bank` (Req) | `permata`,`bni`,`bri`,`bca`,`cimb` (docs list permata/bni/bri/bca; CIMB VA has its own page). |
| `va_number` (Opt) | Custom VA. Shorter than min → left-padded with zeros; longer than max → trimmed. BCA 6–18 digits; Permata 12; BNI 8 (5-digit client ID) or 12 (3-digit client ID); BRI 18; CIMB 12. (BNI object also documents custom number length 1–8.) |
| `free_text` (Opt, BCA only) | `{inquiry:[{id,en}], payment:[{id,en}]}` each ≤10 entries, each text ≤50 chars. |
| `bca.sub_company_code` | default `00000`. |
| `permata.recipient_name` | shown as 20-char uppercase; default merchant name. |

## echannel object (Mandiri Bill)
`bill_info1` (label ≤10 chars, Req), `bill_info2` (value ≤30, Req), `bill_info3..8` (Opt; pairs label/value). Over-length is **truncated**. `bill_key` (Opt, 6–12 digits, B2C & B2B): padded/trimmed like VA; if a previous transaction with the same key is still active (B2C: status `pending`; B2B: stays active until cancelled) Midtrans returns a random bill key instead.

## gopay object
| Field | Notes |
|---|---|
| `enable_callback` (Opt, default false) | Append callback URL to deeplink (deeplink/QRIS). |
| `callback_url` (Opt) | Where Gojek/GoPay app returns user. For Tokenization it must equal the URL submitted at onboarding (whitelisted); defaults to dashboard Finish URL. |
| `account_id` (Cond) | Tokenization: from Create Pay Account. |
| `payment_option_token` (Cond) | Tokenization: from Get Pay Account metadata. |
| `pre_auth` (Opt) | `true` reserves balance; then call Capture. |
| `recurring` (Opt) | `true` = no PIN challenge; authorized merchants only. |
| `promotion_ids` (Opt) | Tokenization only; first ID used; from Fetch Promotion API. |

## shopeepay / ovo / qris
- `shopeepay: { "callback_url": "https://..." }` (Opt; default = dashboard Finish URL).
- `ovo: { "payer_phone_number": "081111111111" }` (Opt per docs; the customer phone that receives the OVO push).
- `qris: { "acquirer": "gopay" | "airpay shopee" }` (default `gopay`).

## cstore object (OTC)
`store` (String(20), Req: `indomaret` | `alfamart`), `message` (≤20, Indomaret POS label), `alfamart_free_text_1/2/3` (≤40 each; receipt rows).

## va_numbers (response)
`"va_numbers": [{ "bank": "bca", "va_number": "91019021579" }]` — `bank` ∈ permata/bni/bri/bca. Permata returns `permata_va_number`; Mandiri returns `bill_key` + `biller_code`.

## action object (response `actions[]`)
`{ name, method, url, fields[] }` — e.g. `generate-qr-code`, `generate-qr-code-v2` (ASPI-bordered QR), `deeplink-redirect`, `get-status`, `cancel`, `verification-link-url`, `verification-link-app`, `activation-link-url`, `activation-link-app`. Always look up an action **by `name`**, never by array index.

## Validation errors
`400` body: `{ "status_code":"400","status_message":"One or more parameters in the payload is invalid.","validation_messages":["transaction_details.order_id is required"],"id":"..." }` — show `validation_messages` in logs.
