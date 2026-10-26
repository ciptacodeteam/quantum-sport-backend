---
name: midtrans-core-notifications
description: Implement and secure the Midtrans HTTP payment notification (webhook) endpoint — signature_key SHA512 verification, which statuses mean paid, idempotency, out-of-order handling, HTTP response codes and retry policy, pay-account (GoPay linking) notifications, refund notifications. Load for any webhook / payment callback / "mark order as paid" work.
---

# Midtrans Core API — Notifications (Webhook)

Sources: docs.midtrans.com/reference/notifications-handling, /receiving-notifications, /best-practices-to-handle-notification.

Two notification types, each with its own URL configured in the dashboard (MAP → Settings → Payment):
1. **Transaction notification** → "Payment Notification URL" — every status change (pending, settlement/capture, deny, cancel, expire, refund, partial_refund, chargeback…).
2. **Pay Account notification** → "Pay Account Notification URL" — GoPay Tokenization linked/unlinked.
(Subscription has a third, separate "Recurring Notification URL" → `midtrans-core-subscription`.)

Make sure email notification is enabled in General Settings so features such as save-card / one-click work.

## 1. Verify authenticity — three layers, use all

**A. Signature key** — present in every notification.
```
Transaction notification : SHA512(order_id + status_code + gross_amount + ServerKey)
Pay Account notification : SHA512(account_id + account_status + status_code + ServerKey)
```
Concatenate the **raw string values exactly as received** (e.g. `gross_amount` is `"145000.00"`, not `145000`). Compare with constant-time equality. Mismatch → ignore (respond 4xx/ignore; do not change any order).

**B. Re-check with the API** (strongest): call `GET /v2/{order_id}/status` (or `GET /v2/pay/account/{account_id}`) and trust *that* response. Recommended for money-affecting transitions.

**C. Transport**: HTTPS endpoint, standard port 80/443, valid (non self-signed) certificate. Do not depend on the `User-Agent` header.

### Code
```js
// Node
import crypto from 'node:crypto';
export function validSignature(n, serverKey) {
  const raw = `${n.order_id}${n.status_code}${n.gross_amount}${serverKey}`;
  const expected = crypto.createHash('sha512').update(raw).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(n.signature_key || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```
```python
# Python
import hashlib, hmac
def valid_signature(n: dict, server_key: str) -> bool:
    raw = f"{n['order_id']}{n['status_code']}{n['gross_amount']}{server_key}"
    expected = hashlib.sha512(raw.encode()).hexdigest()
    return hmac.compare_digest(expected, str(n.get('signature_key', '')))
```
```php
// PHP
function valid_signature(array $n, string $serverKey): bool {
    $expected = hash('sha512', $n['order_id'].$n['status_code'].$n['gross_amount'].$serverKey);
    return hash_equals($expected, (string)($n['signature_key'] ?? ''));
}
```

## 2. Deciding "paid"

Check all three fields of a transaction notification:

| Field | Paid value |
|---|---|
| `status_code` | `200` |
| `transaction_status` | `settlement` (all non-card) or `capture` (card) |
| `fraud_status` | `accept` (present for card) |

Decision table (post-verification):

| transaction_status | fraud_status | Action |
|---|---|---|
| `capture` | `accept` | Card paid → fulfil. (Later becomes `settlement`; keep as paid.) |
| `capture` | `challenge` | Hold. Merchant must call **approve** or **deny** (else auto-cancelled at settlement). Do **not** fulfil. |
| `settlement` | any/absent | Paid → fulfil (idempotently). |
| `pending` | – | Awaiting payment (VA number / QR / redirect issued). |
| `authorize` | – | Card pre-auth; funds reserved; capture needed. |
| `deny` | – | Rejected by bank/FDS/provider. Mark failed; allow new `order_id`. |
| `cancel` | – | Cancelled. |
| `expire` | – | Unpaid until expiry. Release stock; `order_id` can be reused. |
| `failure` | – | Unexpected processing error. Verify via GET status. |
| `refund` / `partial_refund` | – | Update refund records (`refunds[]`, `refund_amount`). |
| `chargeback` / `partial_chargeback` | – | Card dispute. |

**Reversal warning**: for Permata VA, Mandiri Bill, Indomaret (and similar), a `settlement` can flip to `deny` within ~1 minute because the provider reverses the payment. Delay irreversible fulfilment by ~1–2 minutes or re-check status before shipping digital goods.

Notification status codes: `200` success, `201` pending/challenge, `202` deny/cancel/expire (cancel notification carries 202).

## 3. Handler rules (Midtrans best practices)

1. **Respond fast**: HTTP timeout is **15 s**; aim for <5 s. Verify → enqueue/update → return `200`. Do heavy work asynchronously.
2. **Idempotent**: key by `order_id` (or `account_id`). Midtrans may (rarely) send the same event more than once; no duplicate fulfilment/ledger rows. Use a DB unique constraint + transaction/row lock.
3. **Out-of-order**: e.g. `settlement` may arrive before `pending`. Ignore notifications that would move a transaction *backwards* (final: settlement/capture-accept, deny, cancel, expire, refund). If unsure, call GET status and use it.
4. **Check current status** when you expect a notification but none arrived: expected latency — settlement notification up to ~20 s, expiry notification up to ~90 s. Poll `GET /v2/{order_id}/status` as a fallback (reconciliation job for pending orders).
5. **Parse JSON non-strictly**: new fields get added; ignore unknown fields.
6. **Store the full raw payload** + signature check result for audit.
7. **Return the correct HTTP status** — Midtrans reacts to it:

| Your response | Midtrans behaviour |
|---|---|
| `2xx` | Success, no retry |
| `500` | retry once |
| `503` | retry 4 times |
| `400` / `404` | retry 2 times |
| `301/302/303` | no retry (fix URL in dashboard instead) |
| `307/308` | follows redirect with POST + same body, max 5 redirects |
| any other failure | retry 5 times |

Retry policy: at most 5 retries at increasing intervals — 2 min, 10 min, 30 min, 1.5 h, 3.5 h.

For a **bad signature** return a non-2xx only if you want Midtrans to retry; usually return `403`/`400` and log (an attacker's request should not alter data). For a **valid but already-processed** notification return `200`.

## 4. Pay Account (GoPay Tokenization) notifications

```json
{ "account_id":"00000269-...","merchant_id":"M099098","payment_type":"gopay",
  "status_code":"200","account_status":"ENABLED","status_message":"Midtrans account_linked notification" }
```
- Link success: `status_code 200`, `account_status ENABLED`. Unlink: `204`, `DISABLED` (also fires automatically when the user changes GoPay phone number/PIN, or unlinks inside the Gojek/GoPay app).
- Check `status_code` ∈ {200 for ENABLED, 204 for DISABLED} and `account_status`.
- After a link notification **always call Get Pay Account** to fetch balance, status and `payment_option_token` (the token can change, e.g. account upgrade).

## 5. Refund notifications

Midtrans sends **two** refund notifications: one without and one with `bank_confirmed_at` per refund entry. Treat the one **with `bank_confirmed_at`** as "refund confirmed by bank/provider". Payload carries `refund_amount` (cumulative) and `refunds[]` {`refund_chargeback_id`,`refund_amount`,`created_at`,`reason`,`refund_key`,`refund_method` (online/offline),`bank_confirmed_at`}.

## 6. Skeleton endpoint (Express)

```js
app.post('/midtrans/notify', express.json(), async (req, res) => {
  const n = req.body;
  if (!validSignature(n, process.env.MIDTRANS_SERVER_KEY)) return res.sendStatus(403);
  // Optional but recommended for money moves: re-fetch authoritative status
  const st = await midtrans('GET', `/v2/${encodeURIComponent(n.order_id)}/status`);
  const status = st.transaction_status, fraud = st.fraud_status;
  await db.tx(async (t) => {
    const order = await t.lockOrder(n.order_id);          // SELECT ... FOR UPDATE
    if (!order) return;                                    // unknown order: 200 anyway
    if (order.final) return;                               // idempotent
    if ((status === 'capture' && fraud === 'accept') || status === 'settlement') await t.markPaid(order, st);
    else if (status === 'capture' && fraud === 'challenge') await t.markReview(order, st);
    else if (['deny','cancel','expire','failure'].includes(status)) await t.markFailed(order, status);
    else if (status === 'pending') await t.markPending(order, st);
    else if (['refund','partial_refund'].includes(status)) await t.recordRefund(order, st);
  });
  res.sendStatus(200);
});
```

## 7. Checklist
- [ ] Notification URL set per environment in dashboard (sandbox and production are separate).
- [ ] Signature verified with raw strings; constant-time compare.
- [ ] Idempotent state machine, row lock, no backward transitions.
- [ ] Amount check: `gross_amount` from notification equals your order total.
- [ ] Reconciliation job: poll GET status for orders pending past expected time.
- [ ] Reversal-safe fulfilment for VA / Mandiri / OTC.
- [ ] Endpoint returns <5 s, HTTPS, no redirects.
