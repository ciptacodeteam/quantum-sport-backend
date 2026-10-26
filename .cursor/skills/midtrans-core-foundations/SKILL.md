---
name: midtrans-core-foundations
description: Midtrans Core API foundations — getting started, Basic Auth (Server Key base64), sandbox/production base URLs, required headers, 16KB body limit, Idempotency-Key, X-Payment-Locale, rate limit, plus a ready HTTP client in Node/Python/PHP. Load for any Midtrans Core API implementation before payment-method skills.
---

# Midtrans Core API — Foundations

Sources: docs.midtrans.com/reference/getting-started-with-your-api-1, /authorization, /https-request-1, /api-headers.

## 1. Getting started

1. Log in to the Midtrans Merchant Administration Portal (MAP): https://dashboard.midtrans.com (sandbox: https://dashboard.sandbox.midtrans.com).
2. Pick the **Sandbox** environment, open *Settings → Access Keys* and read **Server Key** and **Client Key**.
3. Create a transaction with `POST /v2/charge` to get an `order_id`/`transaction_id`.
4. Check it with `GET /v2/{order_id}/status`.

Core API on **Production requires activation** by Midtrans. Sandbox is active by default. Include the key in every request.

## 2. Authentication (HTTP Basic)

`Authorization: Basic base64(ServerKey + ":")` — Server Key is the *username*, password is empty, **the colon must be included** before encoding.

Doc example: key `Mid-server-abc123cde456` → string `Mid-server-abc123cde456:` → header `Basic <base64 of that string>`.

Sandbox and production keys are different; switch both key and base URL together. Client Key is only for client-side calls (`/v2/token`, `/v2/card/register`, `/v1/bins`, `google_auth`).

## 3. Base URLs and headers

| Env | Base URL |
|---|---|
| Sandbox | `https://api.sandbox.midtrans.com` |
| Production | `https://api.midtrans.com` |
| Full PAN / Google Pay charge — sandbox | `https://panapi.sandbox.midtrans.com/v2/charge` |
| Full PAN / Google Pay charge — production | `https://panapi.midtrans.com/v2/charge` |

Post-charge calls (status, cancel, refund) for Full PAN / Google Pay still use `api.sandbox.midtrans.com` / `api.midtrans.com`.

Required headers on every call:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `Accept` | `application/json` |
| `Authorization` | `Basic base64(ServerKey:)` |

Optional headers:

| Header | Purpose |
|---|---|
| `Idempotency-Key` | Safe retries (see §4). |
| `X-Payment-Locale` | `id-ID` (default) or `en-EN`; language of web pages rendered by the payment type — currently only GoPay linking & charge. |
| `X-POP-ID` | Merchant POP ID; only if Midtrans tells you your integration needs it. |

Max HTTP request size: **16 KB**.

## 4. Idempotency-Key

- Send a unique value (UUID recommended) on POST requests; Midtrans processes the operation once and returns the same stored response for the same key **regardless of request body**.
- Only successful responses are stored. Key lifetime: **5 minutes**; after that the request is processed again (a second charge with the same `order_id` then fails with a conflict).
- Key is **global across endpoints** → use a new key for every distinct operation on the same transaction (e.g. `"<uuid>-charge"`, `"<uuid>-refund"`).
- Max length **46**; longer keys are silently ignored.
- If you retry while the first request is still running → HTTP `202` until it finishes.
- Accepted on all POST endpoints **except** `/token` and `/account`.
- **Not supported** for: Permata VA, CIMB Clicks, KlikBCA, Indomaret. For those, protect against double charge with your own unique `order_id` (a duplicate returns `406`).
- Subscription create supports it too, with a 3-minute window (validated before idempotency check).

## 5. Rate limits

`429` — "API rate limit exceeded"; the global rate limit applies to **Create Pay Account** and **Charge** APIs. BIN API: 100 req/min, over limit returns `409`. Back off with jitter; do not hammer retries.

## 6. Ready HTTP client

### Node.js (18+, no dependency)
```js
const BASE = process.env.MIDTRANS_ENV === 'production'
  ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
const AUTH = 'Basic ' + Buffer.from(process.env.MIDTRANS_SERVER_KEY + ':').toString('base64');

export async function midtrans(method, path, body, idempotencyKey) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': AUTH,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  // Business result is in json.status_code (string), not only in res.status.
  return { http: res.status, ...json };
}
// const r = await midtrans('POST', '/v2/charge', payload, crypto.randomUUID());
```

### Python (requests)
```python
import os, base64, uuid, requests

BASE = "https://api.midtrans.com" if os.getenv("MIDTRANS_ENV") == "production" else "https://api.sandbox.midtrans.com"
AUTH = "Basic " + base64.b64encode((os.environ["MIDTRANS_SERVER_KEY"] + ":").encode()).decode()

def midtrans(method, path, body=None, idem=None):
    headers = {"Content-Type": "application/json", "Accept": "application/json", "Authorization": AUTH}
    if idem: headers["Idempotency-Key"] = idem
    r = requests.request(method, BASE + path, json=body, headers=headers, timeout=30)
    data = r.json() if r.content else {}
    data["_http"] = r.status_code
    return data
```

### PHP (curl)
```php
function midtrans(string $method, string $path, ?array $body = null, ?string $idem = null): array {
    $base = getenv('MIDTRANS_ENV') === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
    $h = ['Content-Type: application/json', 'Accept: application/json',
          'Authorization: Basic ' . base64_encode(getenv('MIDTRANS_SERVER_KEY') . ':')];
    if ($idem) $h[] = 'Idempotency-Key: ' . $idem;
    $ch = curl_init($base . $path);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $h,
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
        CURLOPT_POSTFIELDS => $body ? json_encode($body) : null]);
    $out = curl_exec($ch); $http = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    $j = json_decode($out ?: '{}', true) ?: [];
    $j['_http'] = $http;
    return $j;
}
```

## 7. Implementation checklist

- [ ] Keys in env/secret manager (GCP Secret Manager etc.), never in repo or frontend.
- [ ] Separate sandbox/production config switched by one variable.
- [ ] Timeout ≤30 s on calls; on timeout **do not blindly re-charge** — retry with the same `Idempotency-Key` or call `GET /v2/{order_id}/status` first.
- [ ] Always read `status_code` from the body.
- [ ] Log `transaction_id`, `order_id`, `status_code`, `status_message`; never log Server Key or full card data.
- [ ] Reject/avoid decimals in amounts and illegal characters in `order_id`.
