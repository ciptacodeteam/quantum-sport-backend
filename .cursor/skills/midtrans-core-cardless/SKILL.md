---
name: midtrans-core-cardless
description: Midtrans Core API cardless credit (buy now pay later) — Akulaku PayLater and Kredivo via payment_type akulaku / kredivo, required customer/item/seller details, redirect_url flow, expiry, callback URL format. Load for BNPL implementation.
---

# Midtrans Core API — Cardless Credit (Akulaku, Kredivo)

Sources: /reference/payment-method-cardless-credit, /akulaku-1, /kredivo-1.
Merchant is paid in full at normal settlement; the customer repays the provider in installments.

Flow: charge → `201 pending` + `redirect_url` → redirect the customer to the provider → provider returns to your **Finish Redirect URL** (Dashboard › Settings › Payments) → rely on notification. Error codes: 400, 401, 402, 406, 410. Refund and cancel supported per payment-api rules (needs activation for refund). Cancel while pending allowed.

## Akulaku PayLater (`akulaku`)
```json
{ "payment_type":"akulaku",
  "transaction_details":{"order_id":"orderid-01","gross_amount":11000},
  "item_details":[{"id":"1","price":11000,"quantity":1,"name":"Sepatu"}],
  "customer_details":{"first_name":"John","last_name":"Baker","email":"john.baker@email.com","phone":"08123456789"} }
```
- `item_details` and `customer_details` are **required**; each item `id` must be unique in the request.
- Default expiry **2 h** (min 20 s, max 180 days).
- Response: `redirect_url`, `channel_response_code/message`, `transaction_status: pending`.
- Notification statuses: pending, settlement, expire, deny.

## Kredivo (`kredivo`)
```json
{ "payment_type":"kredivo",
  "transaction_details":{"order_id":"orderid-01","gross_amount":40000,"currency":"IDR"},
  "customer_details":{ "email":"…","first_name":"John","last_name":"Baker","phone":"08123456789",
     "shipping_address":{"first_name":"John","last_name":"Baker","phone":"08123456789","address":"Jl. Kemanggisan","city":"Jakarta","postal_code":"12353","country_code":"IDN"} },
  "item_details":[{"id":"1","name":"Sepatu","price":40000,"category":"Fashion","quantity":1,"url":"https://shop.example/item/abc"}],
  "seller_details":[{"id":"sellerId-01","name":"John Seller","email":"seller@email.com","url":"https://tokojohn.com",
     "address":{"first_name":"John","last_name":"Seller","phone":"081234567890","address":"Kemanggisan","city":"Jakarta","postal_code":"12190","country_code":"IDN"}}],
  "custom_expiry":{"expiry_duration":60,"unit":"minute"} }
```
- `customer_details` and `item_details` are mandatory by default with **all fields in the sample required** (item: `category`, `url`; customer: shipping address). Making them optional needs Kredivo approval.
- `seller_details` mandatory only for **marketplace** merchants.
- Default expiry **24 h** (min 20 s, max 180 days).
- Response: `redirect_url`, `merchant_id`, `channel_response_code: "OK"`.
- Return redirect from Kredivo is an HTTP **GET** to your Finish URL — endpoint must accept GET and be a page you own. Since **Jan 2024** Midtrans appends transaction info (query parameters) to the callback URL (gradual rollout) → support both old (no params) and new formats.
- Refund window 14 days.

## Checklist
- [ ] Send all mandatory customer/item (and seller for marketplace) fields.
- [ ] Redirect customer to `redirect_url`; Finish URL accepts GET.
- [ ] Never treat the browser return as payment proof.
- [ ] Handle `deny` and `expire`.
