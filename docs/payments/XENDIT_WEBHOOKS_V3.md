# Xendit V3 Webhook Implementation

This document describes the implementation of Xendit Payment API v3 webhooks.

## Webhook Endpoints

### 1. Payment Token Status Webhook

**Endpoint:** `POST /webhooks/xendit/payment-token`

Handles payment token lifecycle events (activation/deactivation).

**Events:**

- `payment_token.activation` - When a payment token is activated
- `payment_token.deactivation` - When a payment token is deactivated

**Example Payload:**

```json
{
  "created": "2025-02-13T09:08:30.836Z",
  "business_id": "62440e322008e87fb29c1fd0",
  "event": "payment_token.activation",
  "api_version": "v3",
  "data": {
    "status": "ACTIVE",
    "payment_token_id": "pt-23262b37-94a7-42e3-9adc-15e91c996298",
    "reference_id": "90392f42-d98a-49ef-a7f3-90392f42d98a",
    "currency": "IDR",
    "country": "ID",
    "created": "2025-02-13T09:08:12.380Z",
    "updated": "2025-02-13T09:08:30.664Z",
    "channel_code": "CARDS",
    "channel_properties": { ... }
  }
}
```

**Current Behavior:**

- Verifies callback token
- Logs the payment token event
- Returns success response

**Future Enhancement:**
Store payment tokens for recurring payments/card-on-file scenarios.

---

### 2. Payment Request Status Webhook

**Endpoint:** `POST /webhooks/xendit/payment-request`

Handles payment request lifecycle events.

**Events:**

- `payment_request.created` - When a payment request is created
- `payment_request.completed` - When payment request is successfully completed
- `payment_request.failed` - When payment request fails
- `payment_request.expired` - When payment request expires

**Example Payload:**

```json
{
  "created": "2025-02-13T09:08:30.836Z",
  "business_id": "62440e322008e87fb29c1fd0",
  "event": "payment_request.completed",
  "api_version": "v3",
  "data": {
    "id": "pr-123456789",
    "reference_id": "invoice_cuid_here",
    "status": "COMPLETED",
    "amount": 100000,
    "currency": "IDR",
    "country": "ID",
    "created": "2025-02-13T09:08:12.380Z",
    "updated": "2025-02-13T09:08:30.664Z"
  }
}
```

**Behavior:**

1. Verifies callback token
2. Finds invoice by `reference_id` (searches both `id` and `number` fields)
3. Updates invoice status based on payment request status:
   - `COMPLETED` → `PAID`
   - `FAILED` → `FAILED`
   - `EXPIRED` → `EXPIRED`
   - `PENDING` → `PENDING`
4. Updates payment record with status and metadata
5. Executes business logic:

**On COMPLETED:**

- Confirms booking (if exists)
- Confirms class booking (if exists)
- Activates membership (if exists)

**On FAILED/EXPIRED:**

- Cancels booking (if exists)
- Cancels class booking (if exists)
- Suspends membership (if exists)

---

### 3. Payment Status Webhook

**Endpoint:** `POST /webhooks/xendit/payment-status`

Handles individual payment capture/failure events.

**Events:**

- `payment.capture` - When a payment is successfully captured
- `payment.failure` - When a payment fails

**Example Payload:**

```json
{
  "created": "2025-02-13T09:08:30.836Z",
  "business_id": "62440e322008e87fb29c1fd0",
  "event": "payment.capture",
  "api_version": "v3",
  "data": {
    "id": "pay-123456789",
    "reference_id": "invoice_cuid_here",
    "payment_request_id": "pr-123456789",
    "status": "SUCCEEDED",
    "amount": 100000,
    "currency": "IDR",
    "channel_code": "MANDIRI",
    "created": "2025-02-13T09:08:12.380Z",
    "updated": "2025-02-13T09:08:30.664Z"
  }
}
```

**Behavior:**
Same as the existing v3 payment webhook handler. Maps to:

- `payment.capture` → `PAID` status
- `payment.failure` → `FAILED` status

---

## Legacy Endpoint (Backward Compatibility)

**Endpoint:** `POST /webhooks/xendit`

The original unified webhook endpoint that automatically detects and routes:

- V3 payment webhooks (has `event` field with `payment.capture`/`payment.failure`)
- V2 invoice webhooks (legacy format)

**Recommendation:** Configure Xendit to use the specific V3 endpoints above for better separation of concerns.

---

## Security

All webhook endpoints verify the `x-callback-token` header against your configured `XENDIT_CALLBACK_TOKEN` environment variable.

**Invalid token responses:**

- `401 Unauthorized` - Missing or invalid callback token

---

## Error Responses

- `400 Bad Request` - Missing required fields (reference_id, external_id)
- `404 Not Found` - Invoice not found
- `500 Internal Server Error` - Processing error

---

## Configuration

Set the following webhook URLs in your Xendit dashboard:

1. **Payment Token Webhook:** `https://your-domain.com/webhooks/xendit/payment-token`
2. **Payment Request Webhook:** `https://your-domain.com/webhooks/xendit/payment-request`
3. **Payment Status Webhook:** `https://your-domain.com/webhooks/xendit/payment-status`

Or use the legacy unified endpoint: `https://your-domain.com/webhooks/xendit`

---

## Testing

Use the test simulation endpoints (dev-only):

- `POST /xendit-test/payment-requests/:id/simulate`
- `POST /xendit-test/payments/:id/simulate`

These endpoints simulate Xendit callbacks without requiring actual payments.

---

## Database Updates

### Invoice Table

- `status` - Updated based on payment status
- `paidAt` - Set when payment is completed

### Payment Table

- `status` - Updated based on payment status
- `paidAt` - Set when payment is completed
- `externalRef` - Stores Xendit payment/invoice ID
- `meta` - JSON object storing:
  - `payment_request_id`
  - `payment_request_status`
  - `payment_request_event`
  - Other payment metadata

### Booking/ClassBooking Tables

- `status` - Updated to CONFIRMED or CANCELLED

### MembershipUser Table

- `isExpired` - Set to false on successful payment
- `isSuspended` - Set based on payment status
- `suspensionReason` - Reason for suspension
- `suspensionEndDate` - When suspension ends (null for indefinite)
