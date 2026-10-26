---
name: midtrans-core-sandbox-testing
description: Midtrans sandbox testing reference — test cards (3DS2 frictionless/challenge/deny/pending), bank-specific cards, simulators for VA/QRIS/GoPay/ShopeePay/Indomaret/Alfamart, OVO magic phone numbers, Google Pay amounts, GoPay Tokenization test accounts, safety warning. Load when writing tests or manually verifying a Midtrans integration.
---

# Midtrans Core API — Sandbox Testing

Sources: /reference/testing-payment-on-sandbox, /testing-gopay-tokenization-on-sandbox-environment. Sandbox credentials/keys differ from production; sandbox base URL `https://api.sandbox.midtrans.com` (panapi: `https://panapi.sandbox.midtrans.com`).

> **Never pay a sandbox transaction with a real wallet/bank.** References (VA numbers, QR images) can coincide with real provider references; real money may be routed to unrecoverable destinations (QRIS sandbox QR can hit your production MID as `QRIS-{id}`). Do not expose staging to real customers. Use simulators only.

## Cards
Expiry any future date (e.g. `12/2030`), CVV `123`, 3DS OTP `112233`. All support 8-digit BIN. (Sandbox 3DS1 was upgraded to 3DS2 on 31 Jan 2023.)

### 3DS 2 specific (recommended for flow tests)
| Network | Frictionless accept | Frictionless deny | Challenge accept | Challenge deny | Challenge, `pending` first → accept after 60 s | 3DS failed/unattempted → deny |
|---|---|---|---|---|---|---|
| VISA | 4556 5579 5572 6624 · 4024 0071 8944 9340 | 4485 4364 5535 4151 | 4916 9940 6425 2017 | 4604 6331 9421 9929 | 4024 0071 7626 5022 | 4716 1250 5984 7899 |
| MasterCard | 5333 2591 5564 3223 | 5328 7203 8458 2224 | 5306 8899 4283 3340 | 5424 1840 4982 1670 | 5487 9716 3133 0522 | 5250 5486 9206 9390 |
| AMEX | 3415 0209 8634 895 | 3456 9539 9207 589 | 3486 3826 7931 507 | 3720 2110 6351 394 | 3451 9777 1649 926 | 3794 5219 9603 6850 |

3DS1 cards (rejected now): Visa 4723249479082225, MC 5555666677771111, JCB 3528927894502153, Amex 3419184532253540.

### General
| Network | Accept (3DS-ready) | Denied by bank (3DS-ready) | Accept (attempted) | Denied by FDS | Denied by bank (attempted) |
|---|---|---|---|---|---|
| VISA | 4811 1111 1111 1114 | 4911 1111 1111 1113 | 4411 1111 1111 1118 | 4611 1111 1111 1116 | 4711 1111 1111 1115 |
| MasterCard | 5211 1111 1111 1117 | 5111 1111 1111 1118 | 5410 1111 1111 1116 | 5411 1111 1111 1115 | 5511 1111 1111 1114 |
| JCB | 3528 2033 2456 4357 | 3528 5129 4493 2269 | 3528 8680 4786 4225 | 3528 1852 6717 1623 | 3528 9097 7983 7631 |
| AMEX | 3701 9216 9722 458 | 3742 9635 4400 881 | 3737 4772 6661 940 | 3780 9621 8340 018 | 3703 5609 7975 856 |
| CUP | 6212 4878 9242 5802 | 6212 4841 2968 7072 | 6212 4895 0662 1198 | 6212 4825 3517 8193 972 | 6212 4842 2863 5865 |

JCB/AMEX/CUP require acquirer activation.

### Bank-specific (installment, BIN promo, point) — Full / Attempted authentication
| Bank | VISA full | VISA attempted | MC full | MC attempted | Denied VISA / MC |
|---|---|---|---|---|---|
| Mandiri | 4617 0069 5974 6656 | 4617 0017 4194 2101 | 5573 3810 7219 6900 | 5573 3819 9982 5417 | 4617 0085 6083 1760 / 5573 3840 4322 4447 |
| CIMB | 4599 2078 8712 2414 | 4599 2039 9705 2898 | 5481 1698 1883 2479 | 5481 1671 2103 2563 | 4599 2060 0973 3090 / 5481 1691 9178 2739 |
| BNI | 4105 0586 8948 1467 | 4105 0525 4151 2148 | 5264 2210 3887 4659 | 5264 2249 7176 1016 | 4105 0541 4854 1363 / 5264 2235 3013 1711 |
| BCA | 4773 7760 5705 1650 | 4773 7738 1098 1190 | 5229 9031 3685 3172 | 5229 9073 6430 3610 | 4773 7752 0201 1809 / 5229 9034 0542 3830 |
| BRI | 4365 0263 3573 7199 | 4365 0278 6723 2690 | 5520 0298 7089 9100 | 5520 0254 8646 8439 | 4365 0286 6251 2583 / 5520 0219 0920 3008 |
| MEGA | 4201 9100 0000 0009 | 4201 9100 0000 0017 | 5221 0300 0000 0009 | 5221 0300 0000 0017 | 4201 9100 0000 0025 / 5221 0300 0000 0025 |
| Maybank | 4055 7720 2603 6004 | 4055 7713 3514 4012 | 5520 0867 5210 2334 | 5520 0867 7490 8452 | 4055 7796 2846 0474 / 5520 0883 1465 3770 |
Extras: Mandiri Debit full 4097 6611 1111 1113 / attempted 4097 6611 1111 1139 (no online installment/promo), denied 4097 6676 7217 8631 · BNI Private Label accept 1946 4159 8148 7684, denied 1946 4102 7193 1269 (BNI acquiring only).
Deny with response code 51: `4472 4298 6999 6670` (any amount), `4806 0000 0000 0081` (amount > Rp 30,000). Offline card (deny, not eligible online): VISA 4705 8595 1098 4866, MC 5597 5189 2656 1951.

## E-wallet / QR
- **QRIS / GoPay / ShopeePay (desktop)**: copy the QR image URL from `actions` into the QRIS Simulator `https://simulator.sandbox.midtrans.com/v2/qris/index`. Deeplink simulator: `https://simulator.sandbox.midtrans.com/v2/deeplink/index` (GoPay and ShopeePay). On mobile the deeplink opens a web simulator, not the real app.
- **OVO**: any random number → happy flow. Magic numbers: `+628249134000` not registered (RC 14) · `+628271939753` user cancelled (RC 17) · `+628242014881` push to OVO app failed (RC 26) · `+628237435829` payment failed (RC 40) · `+628215023424` pending/timeout (RC 68) · `+628242974268` no response in 60 s (expires at 65 s).
- **GoPay Tokenization**: PIN `112233`, OTP `987654`, amount < IDR 100,000 → no PIN, ≥ 100,000 → PIN; test numbers in `midtrans-core-ewallet/references/gopay-tokenization.md`.
- Deprecated: Indosat Dompetku, Mandiri e-Cash.

## Bank transfer simulators
| Method | Simulator |
|---|---|
| Permata, BRI, CIMB (and other Open-API VA) | `https://simulator.sandbox.midtrans.com/openapi/va/index` (choose bank) |
| BCA VA | `https://simulator.sandbox.midtrans.com/bca/va/index` |
| BNI VA | `https://simulator.sandbox.midtrans.com/bni/va/index` |
| Mandiri Bill | `https://simulator.sandbox.midtrans.com/openapi/va/index?bank=mandiri` |

## OTC
Indomaret `https://simulator.sandbox.midtrans.com/indomaret/phoenix/index` · Alfamart `https://simulator.sandbox.midtrans.com/alfamart/index`.

## Google Pay
Join Google group `googlepay-test-mode-stub-data` with the checkout Google account; test cards appear in the wallet (not in production). Midtrans sandbox: amount **10,002 / 10,004 → accept**, **10,001 / 10,003 → deny**, others → deny (unknown card).

## Cardless
Akulaku / Kredivo: redirect goes to their simulator page which displays test credentials.

## Test plan template for an agent
1. Card: frictionless accept → `capture/accept`; challenge accept; challenge deny; 60 s pending→accept; FDS deny; bank deny; pre-auth + capture; refund after settlement (simulate wait).
2. VA/Bill: create → simulator pay → `settlement` webhook; let expire (use short `custom_expiry`) → `expire` webhook.
3. QR/e-wallet: pay via simulator; OVO magic numbers; cancel pending.
4. Webhook: bad signature rejected; duplicate delivery idempotent; out-of-order (settlement before pending) ignored backwards.
5. Duplicate `order_id` → 406; wrong key → 401.
