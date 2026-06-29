# Credit Card Payment with 3DS - API Payload Examples

Complete guide with request/response examples for credit card payment integration.

---

## 1. Save a New Credit Card

### Endpoint

```
POST /credit-cards
```

### Headers

```json
{
  "Authorization": "Bearer <user_access_token>",
  "Content-Type": "application/json"
}
```

### Request Payload

```json
{
  "cardNumber": "4000000000001091",
  "cardholderName": "John Doe",
  "expiryMonth": 12,
  "expiryYear": 2027,
  "cvv": "123",
  "isDefault": true
}
```

### Response (Success)

```json
{
  "success": true,
  "message": "Credit card saved successfully",
  "data": {
    "id": "clr3x7y8z0000abc123456789",
    "cardBrand": "VISA",
    "last4": "1091",
    "expMonth": 12,
    "expYear": 2027,
    "isDefault": true,
    "createdAt": "2026-01-06T10:30:00.000Z"
  }
}
```

### Response (Error - Invalid Card)

```json
{
  "success": false,
  "message": "Failed to tokenize card. Please check your card details and try again.",
  "data": null
}
```

---

## 2. List Saved Credit Cards

### Endpoint

```
GET /credit-cards
```

### Headers

```json
{
  "Authorization": "Bearer <user_access_token>"
}
```

### Response

```json
{
  "success": true,
  "message": "Credit cards retrieved",
  "data": {
    "cards": [
      {
        "id": "clr3x7y8z0000abc123456789",
        "cardBrand": "VISA",
        "last4": "1091",
        "expMonth": 12,
        "expYear": 2027,
        "isDefault": true,
        "createdAt": "2026-01-06T10:30:00.000Z"
      },
      {
        "id": "clr3x9a1b0001def987654321",
        "cardBrand": "MASTERCARD",
        "last4": "4444",
        "expMonth": 6,
        "expYear": 2028,
        "isDefault": false,
        "createdAt": "2026-01-05T15:20:00.000Z"
      }
    ],
    "total": 2
  }
}
```

---

## 3. Update Credit Card (Mark as Default)

### Endpoint

```
PUT /credit-cards/:id
```

### Request Payload

```json
{
  "isDefault": true
}
```

### Response

```json
{
  "success": true,
  "message": "Credit card updated",
  "data": {
    "id": "clr3x9a1b0001def987654321",
    "cardBrand": "MASTERCARD",
    "last4": "4444",
    "expMonth": 6,
    "expYear": 2028,
    "isDefault": true,
    "createdAt": "2026-01-05T15:20:00.000Z"
  }
}
```

---

## 4. Delete Credit Card

### Endpoint

```
DELETE /credit-cards/:id
```

### Response

```json
{
  "success": true,
  "message": "Credit card deleted",
  "data": null
}
```

---

## 5. Checkout with NEW Credit Card (No Save)

### Endpoint

```
POST /checkout
```

### Request Payload

```json
{
  "paymentMethodId": "clr_payment_method_credit_card_id",
  "courtSlots": ["slot_id_1", "slot_id_2"],
  "coachSlots": ["coach_slot_id_1"],
  "inventories": [
    {
      "inventoryId": "inv_id_1",
      "quantity": 2
    }
  ],
  "cardPayment": {
    "cardNumber": "4000000000001091",
    "cardholderName": "John Doe",
    "expiryMonth": 12,
    "expiryYear": 2027,
    "newCardCvv": "123",
    "saveCard": false
  }
}
```

### Response (Success - Requires 3DS)

```json
{
  "success": true,
  "message": "Checkout successful",
  "data": {
    "bookingId": "booking_abc123",
    "invoiceId": "invoice_xyz789",
    "invoiceNumber": "INV-260106-A3K9FT",
    "totalPrice": 500000,
    "processingFee": 15000,
    "total": 515000,
    "status": "HOLD",
    "paymentStatus": "REQUIRES_ACTION",
    "paymentActions": [
      {
        "type": "REDIRECT_CUSTOMER",
        "value": "https://xendit.co/3ds/challenge/abc123xyz789",
        "descriptor": "WEB_URL"
      }
    ],
    "paymentUrl": "https://xendit.co/3ds/challenge/abc123xyz789"
  }
}
```

**Note**: When `paymentStatus` is `REQUIRES_ACTION`, redirect user to `paymentUrl` to complete 3DS authentication (OTP/password).

---

## 6. Checkout with NEW Credit Card (AND Save for Future)

### Endpoint

```
POST /checkout
```

### Request Payload

```json
{
  "paymentMethodId": "clr_payment_method_credit_card_id",
  "courtSlots": ["slot_id_1"],
  "cardPayment": {
    "cardNumber": "5200000000001096",
    "cardholderName": "Jane Smith",
    "expiryMonth": 8,
    "expiryYear": 2029,
    "newCardCvv": "456",
    "saveCard": true
  }
}
```

### Response

```json
{
  "success": true,
  "message": "Checkout successful",
  "data": {
    "bookingId": "booking_def456",
    "invoiceId": "invoice_uvw321",
    "invoiceNumber": "INV-260106-B7H2KL",
    "totalPrice": 250000,
    "processingFee": 8000,
    "total": 258000,
    "status": "HOLD",
    "paymentStatus": "REQUIRES_ACTION",
    "paymentActions": [
      {
        "type": "REDIRECT_CUSTOMER",
        "value": "https://xendit.co/3ds/challenge/def456uvw321",
        "descriptor": "WEB_URL"
      }
    ],
    "paymentUrl": "https://xendit.co/3ds/challenge/def456uvw321"
  }
}
```

**Note**: Card will be saved to user's account after successful payment.

---

## 7. Checkout with SAVED Credit Card

### Endpoint

```
POST /checkout
```

### Request Payload

```json
{
  "paymentMethodId": "clr_payment_method_credit_card_id",
  "courtSlots": ["slot_id_1", "slot_id_2"],
  "ballboySlots": ["ballboy_slot_id_1"],
  "cardPayment": {
    "savedCardId": "clr3x7y8z0000abc123456789",
    "cvv": "123"
  }
}
```

### Response

```json
{
  "success": true,
  "message": "Checkout successful",
  "data": {
    "bookingId": "booking_ghi789",
    "invoiceId": "invoice_rst654",
    "invoiceNumber": "INV-260106-C9M4NP",
    "totalPrice": 350000,
    "processingFee": 11000,
    "total": 361000,
    "status": "HOLD",
    "paymentStatus": "REQUIRES_ACTION",
    "paymentActions": [
      {
        "type": "REDIRECT_CUSTOMER",
        "value": "https://xendit.co/3ds/challenge/ghi789rst654",
        "descriptor": "WEB_URL"
      }
    ],
    "paymentUrl": "https://xendit.co/3ds/challenge/ghi789rst654"
  }
}
```

**Note**: CVV is always required for security, even with saved cards.

---

## 8. Membership Checkout with NEW Credit Card

### Endpoint

```
POST /checkout/membership
```

### Request Payload

```json
{
  "membershipId": "membership_premium_id",
  "paymentMethodId": "clr_payment_method_credit_card_id",
  "cardPayment": {
    "cardNumber": "4000000000001091",
    "cardholderName": "Alice Johnson",
    "expiryMonth": 3,
    "expiryYear": 2028,
    "newCardCvv": "789",
    "saveCard": true
  }
}
```

### Response

```json
{
  "success": true,
  "message": "Membership checkout successful",
  "data": {
    "membershipUserId": "membership_user_xyz",
    "invoiceId": "invoice_lmn987",
    "invoiceNumber": "INV-260106-D5Q8RT",
    "subtotal": 1000000,
    "processingFee": 25000,
    "total": 1025000,
    "paymentStatus": "REQUIRES_ACTION",
    "paymentActions": [
      {
        "type": "REDIRECT_CUSTOMER",
        "value": "https://xendit.co/3ds/challenge/xyz987lmn654",
        "descriptor": "WEB_URL"
      }
    ],
    "paymentUrl": "https://xendit.co/3ds/challenge/xyz987lmn654"
  }
}
```

---

## 9. Membership Checkout with SAVED Credit Card

### Endpoint

```
POST /checkout/membership
```

### Request Payload

```json
{
  "membershipId": "membership_vip_id",
  "paymentMethodId": "clr_payment_method_credit_card_id",
  "cardPayment": {
    "savedCardId": "clr3x9a1b0001def987654321",
    "cvv": "456"
  }
}
```

### Response

```json
{
  "success": true,
  "message": "Membership checkout successful",
  "data": {
    "membershipUserId": "membership_user_abc",
    "invoiceId": "invoice_opq321",
    "invoiceNumber": "INV-260106-E2W7YT",
    "subtotal": 2000000,
    "processingFee": 45000,
    "total": 2045000,
    "paymentStatus": "REQUIRES_ACTION",
    "paymentActions": [
      {
        "type": "REDIRECT_CUSTOMER",
        "value": "https://xendit.co/3ds/challenge/abc321opq789",
        "descriptor": "WEB_URL"
      }
    ],
    "paymentUrl": "https://xendit.co/3ds/challenge/abc321opq789"
  }
}
```

---

## Error Responses

### Invalid Card Number

```json
{
  "success": false,
  "message": "Unable to initialize payment. Card processing failed. Please check your card details and try again. If the problem persists, contact support.",
  "data": null
}
```

### Card Declined

```json
{
  "success": false,
  "message": "Unable to initialize payment. Card declined by issuer.",
  "data": null
}
```

### Insufficient Funds

```json
{
  "success": false,
  "message": "Unable to initialize payment. Insufficient funds.",
  "data": null
}
```

### Invalid CVV

```json
{
  "success": false,
  "message": "Unable to initialize payment. Invalid CVV.",
  "data": null
}
```

### Expired Card

```json
{
  "success": false,
  "message": "Unable to initialize payment. Card expired.",
  "data": null
}
```

### Amount Too Low

```json
{
  "success": false,
  "message": "Unable to initialize payment. Payment amount (Rp 5,000) is below the minimum limit required by the payment method. Please add more items or choose a different payment method.",
  "data": null
}
```

---

## 3DS Authentication Flow

### Step 1: Initial Payment Request

When you make a checkout request with a credit card, you'll receive a response with `paymentStatus: "REQUIRES_ACTION"` and a `paymentUrl`.

### Step 2: Redirect to 3DS Challenge

Redirect the user to the `paymentUrl` where they will:

- Enter OTP sent to their phone
- Enter card password
- Complete biometric authentication (depending on card issuer)

### Step 3: Webhook Notification

After 3DS completion, Xendit sends a webhook to your backend:

```
POST /xendit/webhook
```

**Webhook Payload (Success)**

```json
{
  "event": "payment.capture",
  "business_id": "your_business_id",
  "created": "2026-01-06T10:35:00.000Z",
  "data": {
    "payment_id": "payment_abc123xyz789",
    "reference_id": "INV-260106-A3K9FT",
    "status": "SUCCEEDED",
    "channel_code": "CREDIT_CARD",
    "request_amount": 515000,
    "captures": [
      {
        "capture_id": "capture_123",
        "capture_amount": 515000,
        "capture_timestamp": "2026-01-06T10:35:00.000Z"
      }
    ]
  }
}
```

### Step 4: Payment Confirmed

Your backend updates:

- Booking status: `HOLD` → `CONFIRMED`
- Invoice status: `PENDING` → `PAID`
- Payment status: `PENDING` → `PAID`

---

## Test Cards (Xendit Sandbox)

### Successful Payment (Requires 3DS)

```
Card Number: 4000000000001091
CVV: Any 3 digits
Expiry: Any future date
Name: Any name
```

### Card Declined

```
Card Number: 4000000000000002
CVV: Any 3 digits
Expiry: Any future date
```

### Insufficient Funds

```
Card Number: 4000000000009995
CVV: Any 3 digits
Expiry: Any future date
```

### Expired Card

```
Card Number: 4000000000000069
CVV: Any 3 digits
Expiry: Any future date
```

---

## Important Notes

1. **CVV Required**: CVV must always be provided, even for saved cards (for PCI compliance).

2. **3DS Mandatory**: All card payments require 3D Secure authentication for security.

3. **Card Storage**: Cards are tokenized and stored at Xendit. Your backend never handles raw card data.

4. **Token Reuse**: Saved card tokens can be reused for future payments (CVV still required).

5. **Payment Method**: Ensure the payment method has `channel: "CREDIT_CARD"` in the database.

6. **Expiry Format**:
   - `expiryMonth`: 1-12 (integer)
   - `expiryYear`: Full year (e.g., 2027, not 27)

7. **Card Validation**: All card validation (Luhn check, expiry, CVV) is done by Xendit.

8. **Error Handling**: Always handle the `REQUIRES_ACTION` status and redirect users to complete 3DS.

---

## Frontend Integration Checklist

- [ ] Create credit card form with: card number, name, expiry, CVV
- [ ] Implement card number masking and validation
- [ ] Add "Save card" checkbox option
- [ ] List saved cards (with masked numbers)
- [ ] Handle 3DS redirect flow
- [ ] Display loading state during 3DS authentication
- [ ] Handle payment success/failure callbacks
- [ ] Show user-friendly error messages
- [ ] Implement CVV re-entry for saved cards
- [ ] Add card brand detection (Visa/Mastercard icons)

---

## Security Best Practices

✅ **Never store raw card data** - Use Xendit tokenization
✅ **Always require CVV** - Even for saved cards
✅ **Enable 3DS** - For all transactions (fraud prevention)
✅ **Use HTTPS only** - For all payment-related requests
✅ **Validate on backend** - Never trust client-side validation alone
✅ **Log payment attempts** - For audit and debugging
✅ **Handle PCI compliance** - By using Xendit's tokenization

---

For more information, refer to:

- [Xendit Cards Documentation](https://docs.xendit.co/docs/cards-pay-and-save)
- [Xendit 3DS Guide](https://docs.xendit.co/docs/cards-authentication-3ds2)
- [Xendit API Reference](https://docs.xendit.co/apidocs/create-payment-request)
