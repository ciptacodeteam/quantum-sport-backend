# Cards Session JS Integration Guide

## Overview

Backend sudah diperbarui untuk mendukung **Cards Session JS** dari Xendit sesuai dokumentasi resmi. Ini adalah cara yang **direkomendasikan** untuk mengintegrasikan pembayaran kartu kredit karena:

- ✅ PCI-compliant (data kartu tidak melalui server Anda)
- ✅ Mendukung 3DS authentication otomatis
- ✅ Mendukung simpan kartu untuk pembayaran selanjutnya

## Frontend Requirements

### 1. Cards Session JS Setup

Frontend harus mengimplementasikan Cards Session JS untuk mengumpulkan data kartu:

- Dokumentasi: https://docs.xendit.co/docs/cards-collecting-card-information
- One-off payment: https://docs.xendit.co/docs/cards-guest-checkout-one-off-payment

Cards Session JS akan menghasilkan token kartu (payment token) yang aman.

### 2. Checkout Request Payload

#### A. One-time Payment (tanpa simpan kartu)

```json
{
  "paymentMethodId": "cmk2ob44l0002ml07v0n4ojet",
  "courtSlots": ["slot_id_1", "slot_id_2"],
  "cardPayment": {
    "cardToken": "pm_xxxxxxxxxxxxx" // dari Cards Session JS
  }
}
```

#### B. Payment + Save Card (PAY_AND_SAVE)

```json
{
  "paymentMethodId": "cmk2ob44l0002ml07v0n4ojet",
  "courtSlots": ["slot_id_1"],
  "cardPayment": {
    "cardToken": "pm_xxxxxxxxxxxxx", // dari Cards Session JS
    "saveCard": true,
    "cardBrand": "VISA", // diperlukan untuk save
    "cardLast4": "1234", // diperlukan untuk save
    "cardExpMonth": 12, // diperlukan untuk save
    "cardExpYear": 2025 // diperlukan untuk save
  }
}
```

#### C. Saved Card Payment

```json
{
  "paymentMethodId": "cmk2ob44l0002ml07v0n4ojet",
  "courtSlots": ["slot_id_1"],
  "cardPayment": {
    "savedCardId": "card_id_from_list_api"
  }
}
```

### 3. Save Card Endpoint

Untuk menyimpan kartu tanpa pembayaran langsung:

**POST /api/credit-cards**

```json
{
  "cardToken": "pm_xxxxxxxxxxxxx", // dari Cards Session JS
  "cardBrand": "VISA",
  "last4": "1234",
  "expMonth": 12,
  "expYear": 2025,
  "isDefault": false
}
```

## Backend Implementation Details

### Payment Request Flow

1. **Cards Session Token Flow** (Recommended):
   - Frontend mengirim token dari Cards Session JS
   - Backend mengirim ke Xendit: `POST /v3/payment_requests`
   - Payload body:
     ```json
     {
       "reference_id": "invoice_xxx",
       "type": "PAY",
       "country": "ID",
       "currency": "IDR",
       "request_amount": 100000,
       "capture_method": "AUTOMATIC",
       "payment_token_id": "pm_xxxxxxxxxxxxx",
       "success_return_url": "https://yoursite.com/success",
       "failure_return_url": "https://yoursite.com/failed"
     }
     ```
     **Note:** Saat menggunakan `payment_token_id`, JANGAN kirim `channel_code` atau `channel_properties`.

2. **Legacy Raw Card Flow** (Fallback):
   - Masih didukung untuk backward compatibility
   - Menggunakan `channel_code: "CARDS"` dengan `card_details`
   - **Tidak direkomendasikan** untuk production

### Priority Order

Backend mengecek payload dengan urutan prioritas:

1. `cardToken` (Cards Session JS) → **Recommended**
2. `savedCardId` (Saved card)
3. `cardNumber` + raw card details → Legacy fallback

## Response Format

Checkout response tetap sama:

```json
{
  "success": true,
  "data": {
    "bookingId": "xxx",
    "invoiceId": "xxx",
    "invoiceNumber": "INV-xxx",
    "totalPrice": 100000,
    "processingFee": 2500,
    "total": 102500,
    "status": "HOLD",
    "paymentStatus": "REQUIRES_ACTION",
    "paymentActions": [
      {
        "type": "REDIRECT_CUSTOMER",
        "value": "https://3ds-challenge-url.com",
        "descriptor": "WEB_URL"
      }
    ]
  }
}
```

## Migration Plan

### Phase 1: ✅ Backend Update (Current)

- ✅ Support Cards Session token via `payment_token_id`
- ✅ Support PAY and PAY_AND_SAVE flows
- ✅ Keep legacy PAN/CVV as fallback

### Phase 2: Frontend Update (Next)

- [ ] Implement Cards Session JS
- [ ] Send `cardToken` instead of raw card details
- [ ] Add card metadata fields for save flow

### Phase 3: Deprecation

- [ ] Remove legacy raw card flow
- [ ] Enforce Cards Session token only

## Testing

### Test Card Numbers (Xendit Test Mode)

- Success: `4000 0000 0000 2503`
- 3DS Challenge: `4000 0000 0000 1091`

### Example cURL

```bash
curl -X POST http://localhost:8000/checkout \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentMethodId": "cmk2ob44l0002ml07v0n4ojet",
    "courtSlots": ["slot_id"],
    "cardPayment": {
      "cardToken": "pm_test_token_from_cards_session"
    }
  }'
```

## References

- Xendit Cards Session: https://docs.xendit.co/docs/cards-collecting-card-information
- One-off Payment: https://docs.xendit.co/docs/cards-guest-checkout-one-off-payment
- Payment API v3: https://docs.xendit.co/apidocs/create-payment-request
- MIT/Recurring: https://docs.xendit.co/docs/en/merchant-initiated-transaction-2

## Support

Jika ada error `INVALID_MERCHANT_SETTINGS`, pastikan:

1. Akun Xendit sudah di-enable untuk cards
2. Menggunakan API key yang sesuai (test/production)
3. IP server sudah di-allowlist di Xendit dashboard
