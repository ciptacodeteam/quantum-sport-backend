---
name: midtrans-core-subscription
description: Midtrans Subscription (Recurring) API v1 — create, get, disable, cancel, enable, update subscriptions for credit card (saved_token_id) and GoPay Tokenization; schedule and retry_schedule; recurring HTTP notifications (subscription.charge). Load for recurring/auto-debit billing with Core API.
---

# Midtrans Subscription / Recurring API (v1)

Sources: /reference/api-methods-1 (+ create/get/disable/cancel/enable/update-subscription, http-notification). Supported payment types: **`credit_card`** (via saved card token) and **`gopay`** (GoPay Tokenization). Midtrans auto-charges at the schedule.

Base: `https://api.sandbox.midtrans.com` / `https://api.midtrans.com` (+ `/v1/subscriptions`), Basic auth with Server Key (see foundations). **Not** under `/v2`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/subscriptions` | Create |
| GET | `/v1/subscriptions/{id}` | Retrieve |
| POST | `/v1/subscriptions/{id}/disable` | Stop future charges (pending retries still run) |
| POST | `/v1/subscriptions/{id}/cancel` | Stop future charges **and** pending retries |
| POST | `/v1/subscriptions/{id}/enable` | Reactivate |
| PATCH | `/v1/subscriptions/{id}` | Update |

Create supports `Idempotency-Key` (validated after body validation; **3-minute** window).

## Prerequisite: get the token
- **Card**: first charge via One Click with `save_token_id: true` → `saved_token_id` (in charge response/notification or GET status). Use it as `token`. (Card skill.)
- **GoPay**: link account (Create Pay Account), then `GET /v2/pay/account/{account_id}` → `metadata.payment_options[].token` (use that as `token`) plus `account_id`. (ewallet/references/gopay-tokenization.md.) In sandbox use the specified test phone numbers.

## Create
```json
POST /v1/subscriptions
{
  "name": "MONTHLY_2019",
  "amount": "14000",
  "currency": "IDR",
  "payment_type": "credit_card",
  "token": "48111111sHfSakAvHvFQFEjTivUV1114",
  "schedule": { "interval": 1, "interval_unit": "month", "max_interval": 12, "start_time": "2026-12-01 07:25:01 +0700" },
  "retry_schedule": { "interval": 1, "interval_unit": "day", "max_interval": 3 },
  "metadata": { "description": "Recurring payment for A" },
  "customer_details": { "first_name": "John", "last_name": "Doe", "email": "johndoe@email.com", "phone": "+62812345678" }
}
```
GoPay variant: `"payment_type":"gopay"`, `token` = payment option token, plus `"gopay":{"account_id":"…"}` (required for gopay).

| Field | Rule |
|---|---|
| `name` | String(40) on create; allowed `- _ ~ .`; used to build each charge's `order_id` = name + 32-digit unique number. (The update page says String(15) — doc inconsistency; keep names ≤15 to be safe.) |
| `amount` | String, integer, no decimals. |
| `currency` | `IDR` only. |
| `schedule.interval` | int, units between charges. |
| `schedule.interval_unit` | `day` \| `week` \| `month`. |
| `schedule.max_interval` | total number of charges (omit/limit per your product). |
| `schedule.start_time` | `YYYY-MM-DD HH:mm:ss +0700`, must be in the future. |
| `retry_schedule` | optional; default behaviour retries failed charges **3 times, hourly**. Fields `interval`, `interval_unit`, `max_interval`. |
| `metadata` | < 1 KB. |

Response: `id` (subscription id), `status: "active"`, `schedule{…, current_interval, next_execution_at}`, `transaction_ids[]` (on GET).

## Get
`GET /v1/subscriptions/{id}` → full object incl. `status` (`active`/`inactive`), `schedule.previous_execution_at`, `schedule.next_execution_at`, `transaction_ids`.

## Disable / Cancel / Enable
All return `{ "status_message": "Subscription is updated." }`. `404` "Subscription doesn't exist." · `500` retry. Use **cancel** when user truly leaves (also kills retries); **disable** to pause.

## Update (PATCH)
```json
{ "name":"MONTHLY_2019","amount":"14000","currency":"IDR","token":"…","schedule":{"interval":1},
  "retry_schedule":{"interval":1,"interval_unit":"day","max_interval":3}, "gopay":{"account_id":"…"} }
```
- Required in body: `name`, `amount`, `currency`, `token`; optional `schedule`, `retry_schedule`, `gopay`.
- **Payment method can't change**: disable, then create a new subscription with the new method.
- In `schedule` only **`interval`** is updatable (not `interval_unit`, `max_interval`). Interval changes take effect **after the next scheduled payment**; other changes apply per docs from the next charge.
- Reactivate a dead/expired subscription: update `schedule` with a future date → resumes at `next_execution_at`.

## Notifications (separate URL!)
Set **Recurring Notification URL** in Dashboard › Settings › Payments. Different from Payment Notification URL. Payloads:
1. **Subscription created**: `{id, name, amount, currency, payment_type, token, status:"active", schedule{start_time,next_execution_at,interval_unit,interval,current_interval:0}, metadata, merchant_id, customer_details, gopay{account_id}?}`
2. **Charge result**: `{ "event_name":"subscription.charge", "transaction":{transaction_status, transaction_id, status_code, channel_response_code/message, …}, "subscription":{id, status:"active"|"inactive", …} }`
   - `transaction.status_code 200` + `capture`/`settlement` → paid for that cycle.
   - Failed card/GoPay charge → `transaction_status` deny/etc.; subscription goes `inactive` when retries are exhausted.
   - `transaction.status_code 500` = no transaction was created; retried per retry config if retries remain. Check `subscription.status`.
Also the normal payment notification URL receives each resulting transaction as usual — de-duplicate by `transaction_id` / `order_id`.

## Implementation notes
- Persist `subscription_id`, `token`, `account_id`, plan, next_execution_at; map the charge `order_id` prefix (name) back to the subscription.
- Verify notification authenticity: re-fetch `GET /v1/subscriptions/{id}` (and transaction GET status) rather than trusting body alone — the recurring payload documentation doesn't specify a signature (I'm not sure whether recurring notifications carry `signature_key`; check a real payload before relying on it).
- Card tokens expire (`saved_token_id_expired_at`) — update the token via PATCH before expiry/after re-collect.
- Notify customers before charge; keep cancel entry point in your UI (chargeback risk if schedule shown ≠ actual schedule).

## Checklist
- [ ] Token acquired through One Click save / Get Pay Account.
- [ ] Recurring Notification URL configured (sandbox & prod).
- [ ] Cancel vs disable semantics used correctly.
- [ ] Idempotency-Key on create.
- [ ] Handling for `inactive` status (dunning, re-collect payment, PATCH schedule to reactivate).
