# Xendit Payment Integration

This document explains how to set up and use the Xendit payment integration in the Quantum Sport Backend.

## Setup Instructions

### 1. Install Xendit (Optional - if you want to use the official SDK)

```bash
npm install xendit-node
```

Or with bun:
```bash
bun add xendit-node
```

### 2. Configure Environment Variables

Add the following environment variables to your `.env` file:

```env
# Xendit Configuration
XENDIT_API_KEY=your_xendit_secret_api_key
XENDIT_CALLBACK_TOKEN=your_webhook_callback_token

# Application Base URL (for redirect URLs)
BASE_URL=https://yourdomain.com

# Webhook Base URL
WEBHOOK_BASE_URL=https://yourdomain.com/webhooks
```

### 3. Get Your Xendit Credentials

1. **API Key**: 
   - Log in to your Xendit dashboard
   - Go to **Settings > API Keys**
   - Copy your **Secret API Key**

2. **Callback Token**:
   - Go to **Settings > Webhooks**
   - Create a new webhook endpoint pointing to: `https://yourdomain.com/webhooks/xendit`
   - Copy the callback token provided

## How It Works

### Checkout Flow with Xendit

1. **User initiates checkout** → `/checkout` endpoint
2. **System creates booking** and calculates totals
3. **Xendit invoice is created** with payment details
4. **User receives payment URL** to complete payment
5. **Xendit sends webhook** when payment is completed
6. **System updates booking status** to CONFIRMED or CANCELLED

### Webhook Endpoint

The webhook endpoint is available at:
```
POST /webhooks/xendit
```

This endpoint:
- Verifies the Xendit callback token
- Updates invoice and payment status
- Updates booking status based on payment outcome
- Handles expired payments

## API Reference

### Checkout Endpoint

**POST** `/checkout`

**Headers:**
```
Authorization: Bearer <user_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "paymentMethodId": "pm_xxx",
  "courtSlots": ["slot1", "slot2"],
  "coachSlots": ["slot3"],
  "ballboySlots": ["slot4"],
  "inventories": [
    {
      "inventoryId": "inv_xxx",
      "quantity": 2
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Checkout successful",
  "data": {
    "bookingId": "booking_xxx",
    "invoiceNumber": "INV-123456",
    "totalPrice": 100000,
    "processingFee": 2000,
    "total": 102000,
    "status": "HOLD",
    "paymentUrl": "https://checkout.xendit.co/web/invoices/xxx"
  }
}
```

## Testing

### Test Payment Flow

1. Use Xendit's test credentials in sandbox mode
2. Make a checkout request
3. Visit the `paymentUrl` in the response
4. Complete the test payment
5. Verify the booking status is updated to CONFIRMED

### Webhook Testing

You can test webhooks locally using ngrok or similar tools:

```bash
# Start your server
npm run dev

# In another terminal, expose to internet
ngrok http 3000

# Use the ngrok URL in Xendit webhook settings
```

## Payment Status Handling

### PAID
- Invoice status → `PAID`
- Payment status → `PAID`
- Booking status → `CONFIRMED`

### EXPIRED
- Invoice status → `EXPIRED`
- Payment status → `EXPIRED`
- Booking status → `CANCELLED`

### PENDING
- Stays in `PENDING` status
- Booking remains in `HOLD` state

## Supported Payment Methods

Xendit supports:
- Credit/Debit Cards
- Bank Transfer (Virtual Accounts)
- E-Wallets (OVO, DANA, GoPay, etc.)
- QRIS
- And more...

The payment method is determined by the `paymentMethodId` in your database.

## Troubleshooting

### Webhook Not Received

1. Check that the webhook URL is accessible from the internet
2. Verify the callback token matches in your env file
3. Check Xendit dashboard for webhook delivery logs
4. Ensure your server logs are showing the webhook attempts

### Payment Not Processing

1. Verify `XENDIT_API_KEY` is set correctly
2. Check that the API key has proper permissions
3. Ensure the amount is within Xendit's limits
4. Verify customer email is valid

### Booking Not Confirming

1. Check webhook logs for errors
2. Verify the invoice ID matches
3. Ensure the transaction is completing in Xendit dashboard
4. Check database for any constraint violations

## Security Considerations

1. **Never expose API keys** in client-side code
2. **Always verify callback tokens** in webhook handlers
3. **Use HTTPS** for webhook endpoints
4. **Validate payment amounts** before updating status
5. **Implement rate limiting** on webhook endpoint

## Additional Resources

- [Xendit Documentation](https://docs.xendit.co/)
- [Xendit Dashboard](https://dashboard.xendit.co/)
- [Node.js SDK](https://github.com/xendit/xendit-node)

