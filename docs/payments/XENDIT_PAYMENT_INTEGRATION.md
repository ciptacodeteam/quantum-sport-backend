# Xendit Payment Integration (v3 API)

This document describes the implementation of Xendit's Payment Request API v3 for one-off payments in the Quantum Sport Backend.

## Overview

The integration uses Xendit's `/v3/payment_requests` endpoint to create payment requests with automatic capture. This supports various payment channels including:

- Virtual Accounts (BCA, BRI, BNI, Mandiri)
- QRIS
- E-wallets (DANA, OVO, LinkAja, ShopeePay)
- And more...

## Architecture

### Flow Diagram

```
User -> Checkout -> Create Payment Request -> Payment Actions -> User Completes Payment
                                                                          |
                                                                          v
                                                            Xendit Webhook -> Update Status
```

### Components

1. **XenditService** (`src/services/xendit.service.ts`)
   - `createPaymentRequestV3()` - Create payment request
   - `getPaymentRequestV3()` - Get payment request details
   - `cancelPaymentRequestV3()` - Cancel pending payment
   - `verifyCallbackToken()` - Verify webhook authenticity

2. **Checkout Handler** (`src/handlers/checkout.handler.ts`)
   - Creates booking and invoice
   - Calls Xendit to create payment request
   - Stores payment request details in `payment.meta`
   - Returns payment actions to frontend

3. **Webhook Handler** (`src/handlers/xendit-webhook.handler.ts`)
   - Handles `payment.capture` event (successful payment)
   - Handles `payment.failure` event (failed payment)
   - Updates invoice, payment, and booking statuses
   - Supports both v2 (legacy) and v3 webhooks

4. **Invoice Detail Handler** (`src/handlers/invoice.handler.ts`)
   - Retrieves invoice with payment details
   - Extracts payment instructions (VA number, QRIS code, redirect URL)
   - Returns structured payment info to frontend

## API Endpoints

### 1. Checkout (Create Payment)

**Endpoint:** `POST /checkout`

**Request:**

```json
{
  "paymentMethodId": "payment-method-id",
  "courtSlots": ["slot-id-1", "slot-id-2"],
  "coachSlots": [],
  "ballboySlots": [],
  "inventories": []
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "bookingId": "booking-id",
    "invoiceId": "invoice-id",
    "invoiceNumber": "INV-20250115-001",
    "totalPrice": 500000,
    "processingFee": 5000,
    "total": 505000,
    "status": "HOLD",
    "paymentStatus": "REQUIRES_ACTION",
    "paymentActions": [
      {
        "type": "REDIRECT_CUSTOMER",
        "value": "https://checkout.xendit.co/web/...",
        "descriptor": "WEB_URL"
      }
    ],
    "paymentUrl": "https://checkout.xendit.co/web/..."
  }
}
```

### 2. Get Invoice Detail (with Payment Instructions)

**Endpoint:** `GET /invoices/:id`

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "invoice-id",
    "number": "INV-20250115-001",
    "status": "PENDING",
    "total": 505000,
    "payment": {
      "id": "payment-id",
      "status": "PENDING",
      "method": {
        "name": "BCA Virtual Account",
        "channel": "BCA_VIRTUAL_ACCOUNT"
      }
    },
    "paymentInstructions": {
      "type": "VIRTUAL_ACCOUNT",
      "bankCode": "BCA",
      "accountNumber": "88888001234567",
      "accountName": "QUANTUM SPORT",
      "expiresAt": "2025-01-16T10:00:00Z"
    }
  }
}
```

### 3. Webhook (Xendit → Backend)

**Endpoint:** `POST /webhooks/xendit`

**Headers:**

- `x-callback-token`: Your Xendit callback token

**Payload (payment.capture):**

```json
{
  "event": "payment.capture",
  "business_id": "business-id",
  "created": "2025-01-15T10:00:00Z",
  "data": {
    "payment_id": "py-xxx",
    "reference_id": "invoice-id",
    "payment_request_id": "pr-xxx",
    "status": "SUCCEEDED",
    "channel_code": "BCA_VIRTUAL_ACCOUNT",
    "request_amount": 505000,
    "captures": [
      {
        "capture_id": "cap-xxx",
        "capture_amount": 505000,
        "capture_timestamp": "2025-01-15T10:00:00Z"
      }
    ]
  }
}
```

## Payment Status Lifecycle

### Payment Request Status

1. **REQUIRES_ACTION** - User action needed (redirect, scan QR, etc.)
2. **SUCCEEDED** - Payment completed successfully
3. **FAILED** - Payment failed
4. **CANCELED** - Manually canceled
5. **EXPIRED** - Payment window expired

### Booking Status Flow

```
HOLD (after checkout)
  ↓
CONFIRMED (after payment.capture webhook)
  or
CANCELLED (after payment.failure/expired)
```

## Channel-Specific Configuration

### Virtual Accounts

```typescript
{
  channel_code: "BCA_VIRTUAL_ACCOUNT", // or BNI, BRI, MANDIRI
  channel_properties: {
    expires_at: "2025-01-16T10:00:00Z" // 24 hours
  }
}
```

**Payment Instructions Type:** `VIRTUAL_ACCOUNT`

- Provides: bankCode, accountNumber, accountName, expiresAt
- User transfers to VA number via mobile/internet banking

### QRIS

```typescript
{
  channel_code: "QRIS",
  channel_properties: {
    expires_at: "2025-01-15T11:00:00Z" // 1 hour
  }
}
```

**Payment Instructions Type:** `QRIS`

- Provides: qrString, qrImage (URL), expiresAt
- User scans QR code with banking/ewallet app

### E-Wallets (DANA, OVO, LinkAja, ShopeePay)

```typescript
{
  channel_code: "DANA", // or OVO, LINKAJA, SHOPEEPAY
  channel_properties: {
    success_return_url: "https://yourapp.com/payment/success",
    failure_return_url: "https://yourapp.com/payment/failed"
  }
}
```

**Payment Actions:** `REDIRECT_CUSTOMER`

- Frontend redirects user to ewallet app/web
- User authorizes payment
- Xendit redirects back to success/failure URL

## Environment Variables

```env
# Xendit Configuration
XENDIT_API_KEY=xnd_development_xxx
XENDIT_CALLBACK_TOKEN=your_webhook_token_here

# Frontend URLs (for redirects)
FRONT_END_URL=http://localhost:3000
BASE_URL=http://localhost:8000
```

## Database Schema

### Payment Table

```prisma
model Payment {
  id              String        @id @default(cuid())
  paymentMethodId String
  status          PaymentStatus @default(PENDING)
  amount          Int           @db.Integer
  fees            Int           @default(0) @db.Integer
  externalRef     String?       @unique // Xendit payment_request_id
  meta            Json?         // Full payment request response
  dueDate         DateTime?
  paidAt          DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @default(now()) @updatedAt

  method  PaymentMethod @relation(...)
  invoice Invoice?
}
```

### Payment Meta Structure

```json
{
  "payment_request_id": "pr-xxx",
  "reference_id": "invoice-id",
  "status": "REQUIRES_ACTION",
  "channel_code": "BCA_VIRTUAL_ACCOUNT",
  "channel_properties": { ... },
  "actions": [
    {
      "type": "REDIRECT_CUSTOMER",
      "value": "https://...",
      "descriptor": "WEB_URL"
    }
  ],
  "request_amount": 505000,
  "currency": "IDR",
  "created": "2025-01-15T10:00:00Z"
}
```

## Frontend Integration

### 1. Display Payment Actions

```typescript
// After checkout
const response = await api.post('/checkout', checkoutData)
const { paymentActions, paymentStatus } = response.data.data

if (paymentStatus === 'REQUIRES_ACTION' && paymentActions) {
  paymentActions.forEach((action) => {
    if (action.type === 'REDIRECT_CUSTOMER') {
      // Redirect user to payment page
      window.location.href = action.value
    } else if (action.type === 'PRESENT_TO_CUSTOMER') {
      // Display QR code or VA number
      if (action.descriptor === 'QR_CODE') {
        renderQRCode(action.value)
      } else if (action.descriptor === 'ACCOUNT_NUMBER') {
        displayVANumber(action.value)
      }
    }
  })
}
```

### 2. Show Payment Instructions

```typescript
// On invoice detail page
const invoice = await api.get(`/invoices/${invoiceId}`)
const { paymentInstructions } = invoice.data.data

if (paymentInstructions) {
  switch (paymentInstructions.type) {
    case 'VIRTUAL_ACCOUNT':
      // Show bank, VA number, expiry
      break
    case 'QRIS':
      // Show QR code image
      break
    case 'INVOICE_URL':
      // Show link or redirect
      break
  }
}
```

### 3. Handle Payment Result

```typescript
// On success return URL
const searchParams = new URLSearchParams(window.location.search)
const invoiceId = searchParams.get('invoice_id')

// Poll for payment status
const checkPaymentStatus = async () => {
  const invoice = await api.get(`/invoices/${invoiceId}`)
  if (invoice.data.data.status === 'PAID') {
    showSuccessMessage()
  } else {
    // Keep polling or show pending
    setTimeout(checkPaymentStatus, 3000)
  }
}
```

## Testing

### Test with Xendit Test Mode

1. Set `XENDIT_API_KEY` to test key (`xnd_development_...`)
2. Use Xendit's test channel codes
3. Simulate payments via Xendit Dashboard

### Test Webhook Locally

```bash
# Start ngrok
npm run dev:ngrok

# Update webhook URL in Xendit Dashboard
https://your-ngrok-url.ngrok-free.app/webhooks/xendit

# Test webhook
curl -X POST https://your-ngrok-url.ngrok-free.app/webhooks/xendit \
  -H "x-callback-token: your_token" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "payment.capture",
    "data": {
      "reference_id": "your-invoice-id",
      "status": "SUCCEEDED",
      "payment_id": "py-test-123"
    }
  }'
```

## Error Handling

### Common Errors

1. **Invalid channel_code**
   - Error: `UNSUPPORTED_CHANNEL`
   - Solution: Check PaymentMethod.channel value

2. **Insufficient channel_properties**
   - Error: `INVALID_CHANNEL_PROPERTIES`
   - Solution: Ensure all required properties are provided

3. **Webhook authentication failed**
   - Error: 401 Unauthorized
   - Solution: Verify XENDIT_CALLBACK_TOKEN matches dashboard

4. **Payment already processed**
   - Webhook may arrive multiple times
   - Solution: Check current status before updating

## Production Checklist

- [ ] Update `XENDIT_API_KEY` to production key
- [ ] Set `XENDIT_CALLBACK_TOKEN` securely
- [ ] Configure webhook URL in Xendit Dashboard
- [ ] Test all payment channels
- [ ] Set appropriate payment expiry times
- [ ] Configure proper success/failure return URLs
- [ ] Enable webhook logging
- [ ] Set up monitoring for failed webhooks
- [ ] Test payment failure scenarios
- [ ] Implement retry logic for failed API calls

## References

- [Xendit Payment Request API](https://docs.xendit.co/docs/pay-one-off-payment)
- [Xendit Webhooks](https://docs.xendit.co/docs/webhooks)
- [Channel Codes](https://developers.xendit.co/api-reference/payments-api/#payment-methods)
