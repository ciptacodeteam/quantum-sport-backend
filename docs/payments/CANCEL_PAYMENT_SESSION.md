# Cancel Payment Session API

## Overview

Implementation of Xendit Payment Session cancellation for handling abandoned or cancelled card payments.

## API Endpoint

**URL:** `POST /checkout/cancel-session`

**Authentication:** Required (Bearer token)

**Request Body:**

```json
{
  "sessionId": "session_abc123"
}
```

**Success Response (200 OK):**

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

**Error Responses:**

- `401 Unauthorized` - Missing or invalid auth token
- `404 Not Found` - Payment session not found
- `400 Bad Request` - Invalid session ID format

## Implementation Files

### 1. Service Layer

**File:** `src/services/xendit.service.ts`

```typescript
async cancelPaymentSession(sessionId: string): Promise<PaymentSessionResponse | null> {
  try {
    const response = await this.xenditClient.post(
      `/sessions/${sessionId}/cancel`,
      {}
    )
    return response.data as PaymentSessionResponse
  } catch (error) {
    logger.error('Error cancelling payment session:', error)
    return null
  }
}
```

### 2. Handler Layer

**File:** `src/handlers/checkout.handler.ts`

```typescript
export const cancelPaymentSessionHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', cancelPaymentSessionSchema, validateHook),
  async (c) => {
    const user = c.get('user')
    const { sessionId } = c.req.valid('json')

    const cancelledSession = await xenditService.cancelPaymentSession(sessionId)

    if (!cancelledSession) {
      throw new NotFoundException(
        'Payment session not found or cannot be cancelled',
      )
    }

    return c.json(
      ok(
        {
          sessionId: cancelledSession.payment_session_id,
          status: cancelledSession.status,
          message: 'Payment session cancelled successfully',
        },
        'Payment session cancelled',
      ),
      status.OK,
    )
  },
)
```

### 3. Route Layer

**File:** `src/routes/checkout.route.ts`

```typescript
const checkoutRoute = createRouter()
  .basePath('/checkout')
  .post('/', ...checkoutHandler)
  .post('/cancel-session', ...cancelPaymentSessionHandler)
```

### 4. Validation Schema

**File:** `src/handlers/checkout.handler.ts`

```typescript
const cancelPaymentSessionSchema = z.object({
  sessionId: z.string().min(1, 'Payment session ID is required'),
})
```

## Xendit API Reference

**Endpoint:** `POST /sessions/{session_id}/cancel`

**Documentation:** https://docs.xendit.co/docs/payment-session#cancel-a-session

**Request:**

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

## Usage Examples

### Frontend Implementation

```typescript
// Cancel payment session when user abandons checkout
async function cancelPayment(sessionId: string) {
  try {
    const response = await fetch('/checkout/cancel-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ sessionId }),
    })

    const result = await response.json()

    if (result.success) {
      console.log('Payment session cancelled:', result.data.status)
      // Redirect user back to booking page or payment method selection
    }
  } catch (error) {
    console.error('Failed to cancel payment session:', error)
  }
}
```

### Use Cases

1. **User Abandonment**
   - User closes payment page before entering card details
   - User navigates away from checkout

2. **Payment Method Change**
   - User wants to switch from card to bank transfer
   - User wants to try a different card

3. **Booking Cancellation**
   - User cancels booking before payment completion
   - Admin cancels booking during pending payment

4. **Session Cleanup**
   - Clean up expired or orphaned sessions
   - Periodic cleanup of abandoned checkout sessions

## Important Notes

1. **Status Check:**
   - Only `ACTIVE` sessions can be cancelled
   - Attempting to cancel already completed/expired sessions will fail

2. **Payment Request Handling:**
   - If card_session.js already created a payment request, you need to use payment request cancel API
   - Check if `payment_request_id` exists before cancelling session

3. **Booking Status:**
   - Cancelling a payment session does NOT automatically cancel the booking
   - Handle booking cancellation separately in your business logic

4. **Idempotency:**
   - Safe to call cancel multiple times on the same session
   - Already cancelled sessions will return 404 or error

## Testing

### Test Scenario 1: Cancel Active Session

```bash
# 1. Create checkout and get payment_session_id
curl -X POST http://localhost:3000/checkout \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentMethodId": "cmk2ob44l0002ml07v0n4ojet",
    "courtSlots": ["slot_id_1"],
    "cardPayment": { "saveCard": false }
  }'

# Response: { "paymentSessionId": "session_abc123", ... }

# 2. Cancel the session
curl -X POST http://localhost:3000/checkout/cancel-session \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "sessionId": "session_abc123" }'

# Response: { "success": true, "data": { "status": "CANCELED" } }
```

### Test Scenario 2: Cancel Non-Existent Session

```bash
curl -X POST http://localhost:3000/checkout/cancel-session \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "sessionId": "invalid_session_id" }'

# Response: 404 Not Found
```

## Related Documentation

- [CARDS_PAYMENT_CORRECT_FLOW.md](./CARDS_PAYMENT_CORRECT_FLOW.md) - Complete card payment flow
- [Xendit Payment Sessions](https://docs.xendit.co/docs/payment-session)
- [Xendit Webhooks](https://docs.xendit.co/docs/webhooks)

## Changelog

- **2024-01-03** - Initial implementation of cancel payment session API
  - Added `cancelPaymentSession()` method to xendit service
  - Created `cancelPaymentSessionHandler` in checkout handler
  - Added `/checkout/cancel-session` route
  - Updated `PaymentSessionResponse` interface to include `CANCELED` status
