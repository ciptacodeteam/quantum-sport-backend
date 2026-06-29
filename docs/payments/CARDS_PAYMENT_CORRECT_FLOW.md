# Xendit Cards Payment - CORRECT IMPLEMENTATION

## ⚠️ CRITICAL: This is the ONLY correct way to integrate card payments

Based on official Xendit documentation and confirmed by Xendit support (Kira).

## Complete Flow

```
┌─────────────┐
│  1. Backend │  Create Payment Session (POST /sessions)
│             │  session_type: PAY | PAY_AND_SAVE
│             │  mode: CARDS_SESSION_JS
│             │  → Returns payment_session_id
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 2. Frontend │  Use card_session.js library
│             │  Xendit.payment.collectCardData({
│             │    payment_session_id: "session_xxx",
│             │    card_number, card_exp_month, card_exp_year, card_cvn
│             │  })
│             │  → card_session.js AUTOMATICALLY creates Payment Request
│             │  → Returns payment_request_id (pr-xxx) + action_url (3DS link)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 3. Frontend │  Redirect user to action_url
│             │  window.location.href = action_url
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   4. User   │  Completes 3DS authentication (OTP)
│             │  Bank page auto-redirects to success/failure URL
│             │  ⚠️  DO NOT close tab manually!
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  5. Backend │  Receive webhook: payment.capture
│             │  Update booking/payment status to CONFIRMED
└─────────────┘
```

## ❌ Common Mistakes to AVOID

1. **DO NOT** call `/v3/payment_requests` manually from backend
2. **DO NOT** send card tokens (`payment_method_id` or `payment_token_id`) to backend
3. **DO NOT** use legacy tokenization API (`/v2/credit_card_tokens`)
4. **DO NOT** close 3DS tab manually - wait for auto-redirect
5. **DO NOT** mix Payment Session with Payment Request APIs

## Implementation Guide

### Step 1: Backend - Create Payment Session

**File:** `src/handlers/checkout.handler.ts` → `handleCreditCardPayment()`

**Request to Backend:**

```json
POST /checkout
{
  "paymentMethodId": "cmk2ob44l0002ml07v0n4ojet",
  "courtSlots": ["slot_id_1"],
  "cardPayment": {
    "saveCard": true  // Optional: false for PAY, true for PAY_AND_SAVE
  },
  //...OTHER_BOOKING_DATA
}
```

**Backend Logic:**

```typescript
// Create Payment Session (NOT Payment Request!)
const paymentSession = await xenditService.createPaymentSession({
  sessionType: shouldSaveCard ? 'PAY_AND_SAVE' : 'PAY',
  mode: 'CARDS_SESSION_JS',
  referenceId: invoiceNumber,
  amount: finalTotal,
  currency: 'IDR',
  country: 'ID',
  cardsSessionJs: {
    successReturnUrl: `${frontendUrl}/payment/success?booking_id=${bookingId}`,
    failureReturnUrl: `${frontendUrl}/payment/failed?booking_id=${bookingId}`,
  },
  metadata: { bookingId, userId, invoiceNumber },
})
```

**Xendit API Call:**

```http
POST https://api.xendit.co/sessions
Authorization: Basic YOUR_SECRET_KEY_BASE64
Content-Type: application/json

{
  "session_type": "PAY",
  "mode": "CARDS_SESSION_JS",
  "reference_id": "INV-260211-5JYM1P",
  "amount": 168369,
  "currency": "IDR",
  "country": "ID",
  "description": "Payment for booking xxx",
  "customer": {
    "given_names": "John",
    "surname": "Doe",
    "email": "john.doe@example.com",
    "mobile_number": "+628123456789"
  },
  "metadata": {
    "bookingId": "xxx",
    "userId": "xxx",
    "invoiceNumber": "xxx"
  },
  "cards_session_js": {
    "success_return_url": "http://localhost:3000/payment/success?booking_id=xxx",
    "failure_return_url": "http://localhost:3000/payment/failed?booking_id=xxx"
  }
}
```

**Backend Response:**

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
    "paymentStatus": "ACTIVE",
    "paymentSessionId": "session_xxxxxxxxx" // ← Use this in frontend!
  }
}
```

### Step 2: Frontend - Collect Card Data

**Load Xendit Card Session JS:**

```html
<script src="https://js.xendit.co/card_session.min.js"></script>
```

**Initialize Card Collection:**

```javascript
// After receiving checkout response
const { paymentSessionId } = checkoutResponse.data

// Collect card data (this will AUTOMATICALLY create payment request!)
Xendit.payment.collectCardData(
  {
    payment_session_id: paymentSessionId,
    card_number: '4000000000002503', // From user input
    card_exp_month: '12',
    card_exp_year: '2025',
    card_cvn: '123',
  },
  (err, response) => {
    if (err) {
      console.error('Card collection failed:', err)
      return
    }

    // response.payment_request_id = "pr-xxxxxxxxx"
    // response.action_url = "https://3ds.xendit.co/..."

    console.log('Payment Request created:', response.payment_request_id)
    console.log('Redirecting to 3DS:', response.action_url)

    // Redirect to 3DS authentication
    window.location.href = response.action_url
  },
)
```

**Important Notes:**

- `collectCardData()` **automatically calls** `/v3/payment_requests` internally
- You **DO NOT** need to call payment request API from backend
- The payment request is created by Xendit's card_session.js library

### Step 3: Frontend - Handle 3DS Redirect

```javascript
// After user completes 3DS, bank will redirect to:
// SUCCESS: http://localhost:3000/payment/success?booking_id=xxx
// FAILURE: http://localhost:3000/payment/failed?booking_id=xxx

// On success page:
const bookingId = new URLSearchParams(window.location.search).get('booking_id')

// Poll booking status or wait for webhook
const checkPaymentStatus = async () => {
  const response = await fetch(`/api/bookings/${bookingId}`)
  const booking = await response.json()

  if (booking.status === 'CONFIRMED') {
    // Payment successful!
    showSuccessMessage()
  } else if (booking.status === 'HOLD') {
    // Still processing, check webhook
    setTimeout(checkPaymentStatus, 2000)
  }
}
```

### Step 4: Backend - Handle Webhook

**File:** `src/handlers/xendit-webhook.handler.ts`

```typescript
// Webhook event: payment.capture
{
  "event": "payment.capture",
  "data": {
    "payment_request_id": "pr-xxxxxxxxx",
    "reference_id": "INV-260211-5JYM1P",
    "status": "SUCCEEDED",
    "amount": 168369,
    "payment_method_id": "pm-xxxxxxxxx",  // For PAY_AND_SAVE
    "metadata": {
      "bookingId": "xxx",
      "userId": "xxx",
      "invoiceNumber": "INV-260211-5JYM1P"
    }
  }
}
```

**Webhook Handler:**

```typescript
async function handlePaymentCapture(webhookData: any) {
  const { reference_id, status, payment_method_id, metadata } = webhookData.data

  // Update booking status
  await db.booking.update({
    where: { id: metadata.bookingId },
    data: { status: 'CONFIRMED' },
  })

  // Update payment status
  await db.payment.update({
    where: {
      /* find by reference_id */
    },
    data: { status: 'PAID' },
  })

  // Save card if PAY_AND_SAVE
  if (payment_method_id && metadata.saveCard) {
    await db.userCreditCard.create({
      data: {
        userId: metadata.userId,
        cardToken: payment_method_id,
        // Card details will be in webhook
        cardBrand: webhookData.data.card_brand,
        last4: webhookData.data.last4,
        expMonth: webhookData.data.exp_month,
        expYear: webhookData.data.exp_year,
      },
    })
  }
}
```

## API Reference

### Payment Session Creation

**Endpoint:** `POST https://api.xendit.co/sessions`

**Request Body:**

```json
{
  "session_type": "PAY" | "PAY_AND_SAVE",
  "mode": "CARDS_SESSION_JS",
  "reference_id": "unique_reference",
  "amount": 100000,
  "currency": "IDR",
  "country": "ID",
  "description": "Payment description",
  "customer": {
    "given_names": "John",
    "surname": "Doe",
    "email": "john.doe@example.com",
    "mobile_number": "+628123456789"
  },
  "metadata": { "key": "value" },
  "cards_session_js": {
    "success_return_url": "https://yoursite.com/success",
    "failure_return_url": "https://yoursite.com/failure"
  }
}
```

**Response:**

```json
{
  "payment_session_id": "session_xxxxxxxxx",
  "reference_id": "unique_reference",
  "session_type": "PAY",
  "mode": "CARDS_SESSION_JS",
  "amount": 100000,
  "currency": "IDR",
  "country": "ID",
  "status": "ACTIVE",
  "created": "2026-02-11T13:00:00Z",
  "metadata": { "key": "value" }
}
```

### Card Collection via card_session.js

```javascript
Xendit.payment.collectCardData(
  {
    payment_session_id: 'session_xxxxxxxxx',
    card_number: '4000000000002503',
    card_exp_month: '12',
    card_exp_year: '2025',
    card_cvn: '123',
  },
  callbackFunction,
)
```

**Callback Response:**

```javascript
{
  payment_request_id: "pr-xxxxxxxxx",
  action_url: "https://3ds.xendit.co/auth/...",
  status: "REQUIRES_ACTION"
}
```

## Cancel Payment Session

If a user abandons the payment or wants to change the payment method before completing 3DS, you can cancel the payment session.

### Backend API

**Endpoint:** `POST /checkout/cancel-session`

**Request:**

```json
{
  "sessionId": "session_abc123"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "sessionId": "session_abc123",
    "status": "CANCELED",
    "message": "Payment session cancelled successfully"
  },
  "message": "Payment session cancelled"
}
```

### Implementation

**File:** `src/handlers/checkout.handler.ts` → `cancelPaymentSessionHandler`

**Usage:**

```typescript
// When user clicks "Cancel Payment" button
const response = await fetch('/checkout/cancel-session', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  },
  body: JSON.stringify({
    sessionId: 'session_abc123',
  }),
})
```

### Xendit API

**Endpoint:** `POST /sessions/{session_id}/cancel`

```http
POST https://api.xendit.co/sessions/session_abc123/cancel
Authorization: Basic YOUR_SECRET_KEY_BASE64
Content-Type: application/json
```

**Response:**

```json
{
  "payment_session_id": "session_abc123",
  "reference_id": "INV-20240103-001",
  "session_type": "PAY",
  "mode": "CARDS_SESSION_JS",
  "amount": 500000,
  "currency": "IDR",
  "country": "ID",
  "status": "CANCELED",
  "created": "2024-01-03T10:00:00.000Z",
  "updated": "2024-01-03T10:05:00.000Z"
}
```

### When to Cancel

- User abandons checkout before entering card details
- User wants to switch payment methods
- Booking is cancelled before payment completion
- Session expires and needs cleanup

### Important Notes

- Only `ACTIVE` sessions can be cancelled
- Once cancelled, no payment requests can be created from this session
- If a payment request was already created, use the payment request cancel API instead
- Cancelling a session does NOT cancel any associated bookings - handle that separately

## Testing

### Test Cards (Xendit Test Mode)

- **Success (No 3DS):** 4000000000002503
- **Success (With 3DS):** 4000000000001091
- **Declined:** 4000000000000002

### Test OTP for 3DS

- Any 6-digit number (e.g., 112233)

## Troubleshooting

### Error: "payment method ID must start with 'pm-'"

- ❌ **Wrong:** Sending card token to backend
- ✅ **Correct:** Backend creates payment session, frontend uses card_session.js

### Error: "Either channel_code or payment_token_id is required"

- ❌ **Wrong:** Calling `/v3/payment_requests` manually
- ✅ **Correct:** Use `/sessions` endpoint, card_session.js handles the rest

### User closed 3DS tab manually

- User will not see success/failure page
- Backend still receives webhook
- Frontend should poll booking status periodically

## Migration Checklist

- [ ] Remove all Card Tokenization v2 code (`/v2/credit_card_tokens`)
- [ ] Remove manual `/v3/payment_requests` calls for cards
- [ ] Implement `/sessions` endpoint for payment session creation
- [ ] Update frontend to use card_session.js library
- [ ] Implement webhook handler for `payment.capture` event
- [ ] Test PAY flow (one-time payment)
- [ ] Test PAY_AND_SAVE flow (save card)
- [ ] Update frontend to poll booking status after 3DS redirect

## Official Documentation

- Payment Sessions: https://docs.xendit.co/docs/payment-session
- Cards Session JS: https://docs.xendit.co/docs/cards-collecting-card-information
- Webhooks: https://docs.xendit.co/docs/webhooks

## Support

If you encounter issues, contact Xendit support with:

- Your merchant ID
- Reference ID (invoice number)
- Error message
- Timestamp of the request
