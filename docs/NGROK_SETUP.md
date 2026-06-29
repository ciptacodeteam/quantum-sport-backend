# Ngrok Setup for Xendit Webhook Testing

## Overview

This guide explains how to set up ngrok tunneling with Docker for testing Xendit webhooks in your development environment. Ngrok exposes your local development server to the internet, allowing Xendit to send webhooks to your application.

## What is Ngrok?

Ngrok is a secure tunneling service that creates a secure tunnel from a public URL to your localhost. This is essential for webhook testing because:

- ✅ Xendit needs a public HTTPS URL to send webhooks
- ✅ Your development server runs on localhost (not accessible from internet)
- ✅ Ngrok bridges this gap securely

## Files Created

```
project/
├── scripts/
│   ├── ngrok-entrypoint.sh      ← Ngrok initialization script
│   └── get-ngrok-url.sh         ← URL monitoring helper
├── docker-compose.ngrok.yml     ← Ngrok-specific Docker setup
└── docs/
    └── NGROK_SETUP.md          ← This documentation
```

## Quick Setup (5 minutes)

### Step 1: Get Ngrok Auth Token

1. Visit [ngrok.com](https://ngrok.com) and create a free account
2. Go to [Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
3. Copy your authtoken

### Step 2: Configure Environment

```bash
# Copy and edit your .env file
cp .env.example .env
nano .env

# Add your ngrok authtoken
NGROK_AUTHTOKEN=your_authtoken_here
```

### Step 3: Start Development with Ngrok

```bash
# Option 1: Standard docker-compose (includes ngrok)
docker-compose up -d

# Option 2: Dedicated ngrok setup (recommended for development)
docker-compose -f docker-compose.yml -f docker-compose.ngrok.yml up -d

# Check if services are running
docker-compose ps
```

### Step 4: Get Your Webhook URL

```bash
# Method 1: Check ngrok monitor logs
docker-compose logs ngrok-monitor

# Method 2: Get URL manually
docker exec ngrok-dev sh /usr/local/bin/get-ngrok-url.sh

# Method 3: Visit ngrok web interface
# http://localhost:4040
```

### Step 5: Configure Xendit Webhooks

1. Copy the webhook URL from step 4 (e.g., `https://abc123.ngrok-free.app/webhooks/xendit`)
2. Go to your [Xendit Dashboard](https://dashboard.xendit.co)
3. Navigate to Settings > Webhooks
4. Add your webhook URL: `https://abc123.ngrok-free.app/webhooks/xendit`
5. Set the callback token from your `.env` file (`XENDIT_CALLBACK_TOKEN`)

## Detailed Configuration

### Environment Variables

```bash
# Required: Your ngrok auth token
NGROK_AUTHTOKEN=2abc123_def456ghi789jkl012mno345pqr678

# Optional: Custom subdomain (paid plans only)
NGROK_DOMAIN=myapp.ngrok-free.app

# Automatically set by ngrok
WEBHOOK_BASE_URL=https://abc123.ngrok-free.app/webhooks

# Xendit configuration
XENDIT_API_KEY=your_xendit_api_key
XENDIT_CALLBACK_TOKEN=your_xendit_callback_token
```

### Docker Services

The setup includes these services:

1. **ngrok**: Creates the tunnel
2. **ngrok-monitor**: Displays the public URL
3. **app**: Your Hono application
4. **db, redis**: Supporting services

## Usage Examples

### Starting Development Environment

```bash
# Start everything including ngrok
docker-compose -f docker-compose.yml -f docker-compose.ngrok.yml up -d

# Watch logs to see the webhook URL
docker-compose logs -f ngrok-monitor

# Expected output:
# 🌐 Ngrok Public URL: https://abc123.ngrok-free.app
# 🎯 Xendit Webhook URL: https://abc123.ngrok-free.app/webhooks/xendit
```

### Testing Webhooks

```bash
# Test your webhook endpoint
curl -X POST https://abc123.ngrok-free.app/webhooks/xendit \
  -H "Content-Type: application/json" \
  -H "x-callback-token: your_callback_token" \
  -d '{
    "id": "test-payment-123",
    "external_id": "test-booking-456",
    "user_id": "test-user-789",
    "is_high": false,
    "payment_method": "BANK_TRANSFER",
    "status": "PAID",
    "merchant_name": "Test Merchant",
    "amount": 100000,
    "paid_amount": 100000,
    "bank_code": "BCA",
    "paid_at": "2025-11-15T10:30:00.000Z"
  }'

# Check your app logs
docker-compose logs app | grep -i webhook
```

### Getting URL Programmatically

```bash
# From inside any container
NGROK_URL=$(curl -s http://ngrok:4040/api/tunnels | jq -r '.tunnels[0].public_url')
echo "Webhook URL: $NGROK_URL/webhooks/xendit"

# From host machine
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')
echo "Webhook URL: $NGROK_URL/webhooks/xendit"
```

## Production Notes

### Free vs Paid Ngrok

| Feature            | Free Plan | Paid Plan     |
| ------------------ | --------- | ------------- |
| Concurrent tunnels | 1         | Multiple      |
| Custom subdomain   | ❌        | ✅            |
| Custom domain      | ❌        | ✅            |
| Rate limiting      | Yes       | Higher limits |
| Session duration   | 8 hours   | Unlimited     |

### Security Considerations

1. **Never use ngrok in production** - Only for development/testing
2. **Rotate auth tokens** regularly
3. **Use strong callback tokens** for Xendit
4. **Monitor webhook logs** for suspicious activity

```bash
# Example: Strong callback token generation
openssl rand -base64 32
```

### Custom Domain Setup (Paid Plans)

```bash
# In your .env file
NGROK_DOMAIN=myapp.ngrok-free.app

# Or use your own domain
NGROK_DOMAIN=webhooks.mydomain.com
```

## Troubleshooting

### Ngrok Service Won't Start

```bash
# Check if authtoken is set
docker-compose exec ngrok env | grep NGROK_AUTHTOKEN

# Verify authtoken is valid
docker-compose logs ngrok | grep -i "authtoken"

# Expected: No errors about invalid token
```

### Can't Access Webhook URL

```bash
# Check if tunnel is active
curl -s http://localhost:4040/api/tunnels | jq '.tunnels[0].public_url'

# Check if app is responding
docker-compose logs app | tail -20

# Test internal connectivity
docker exec ngrok wget -qO- http://app:8000/health
```

### Xendit Webhooks Not Received

```bash
# Check webhook URL format
echo "Expected: https://abc123.ngrok-free.app/webhooks/xendit"

# Verify callback token
docker-compose logs app | grep -i callback

# Check Xendit dashboard for webhook delivery status
```

### Tunnel Disconnects Frequently

```bash
# Check if using free plan (8-hour limit)
# Solution: Use paid plan or restart tunnel

# Restart ngrok service
docker-compose restart ngrok

# Check logs for disconnection reason
docker-compose logs ngrok | grep -i disconnect
```

## Scripts and Helpers

### Get Current Webhook URL

```bash
#!/bin/bash
# get-webhook-url.sh

NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')
if [ -n "$NGROK_URL" ] && [ "$NGROK_URL" != "null" ]; then
    echo "Webhook URL: $NGROK_URL/webhooks/xendit"
else
    echo "Error: Ngrok tunnel not found"
    exit 1
fi
```

### Auto-Update Xendit Webhook (Advanced)

```bash
#!/bin/bash
# update-xendit-webhook.sh
# Automatically update Xendit webhook URL when tunnel changes

NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')
WEBHOOK_URL="$NGROK_URL/webhooks/xendit"

# Use Xendit API to update webhook URL
curl -X PUT "https://api.xendit.co/webhooks/your-webhook-id" \
  -H "Authorization: Basic $(echo -n $XENDIT_API_KEY: | base64)" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$WEBHOOK_URL\"}"
```

## Docker Compose Commands Reference

```bash
# Start with ngrok
docker-compose -f docker-compose.yml -f docker-compose.ngrok.yml up -d

# View all services
docker-compose ps

# Check ngrok logs
docker-compose logs ngrok

# Get webhook URL
docker-compose logs ngrok-monitor

# Stop ngrok only
docker-compose stop ngrok ngrok-monitor

# Restart ngrok (new URL)
docker-compose restart ngrok

# Remove all containers
docker-compose down
```

## Monitoring and Debugging

### Ngrok Web Interface

Visit [http://localhost:4040](http://localhost:4040) for:

- Current tunnel status
- Request/response logs
- Traffic inspection
- Performance metrics

### Log Locations

```bash
# Ngrok startup logs
docker-compose logs ngrok

# Webhook URL information
docker-compose logs ngrok-monitor

# Application webhook handling
docker-compose logs app | grep webhook

# All services
docker-compose logs -f
```

### Health Checks

```bash
# Check all services health
docker-compose ps

# Test app health
curl http://localhost:8000/health

# Test ngrok tunnel
curl -s http://localhost:4040/api/tunnels

# Test webhook endpoint
curl -X POST "$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')/webhooks/xendit" \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

## Best Practices

1. **Keep ngrok running** during development
2. **Use docker-compose.ngrok.yml** for dedicated webhook testing
3. **Monitor the web interface** at http://localhost:4040
4. **Save webhook URLs** when they change
5. **Test webhooks thoroughly** before production deployment
6. **Use strong callback tokens** for security
7. **Rotate tokens regularly** for security

## Integration with Development Workflow

### VS Code Integration

Add to your `.vscode/tasks.json`:

```json
{
  "label": "Start Development with Ngrok",
  "type": "shell",
  "command": "docker-compose -f docker-compose.yml -f docker-compose.ngrok.yml up -d",
  "group": "build",
  "presentation": {
    "echo": true,
    "reveal": "always"
  }
}
```

### Package.json Scripts

Add to your `package.json`:

```json
{
  "scripts": {
    "dev:ngrok": "docker-compose -f docker-compose.yml -f docker-compose.ngrok.yml up -d",
    "ngrok:url": "curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url'",
    "ngrok:webhook": "echo \"$(npm run -s ngrok:url)/webhooks/xendit\"",
    "ngrok:stop": "docker-compose stop ngrok ngrok-monitor"
  }
}
```

Usage:

```bash
# Start development with ngrok
npm run dev:ngrok

# Get webhook URL
npm run ngrok:webhook

# Stop ngrok only
npm run ngrok:stop
```

## Related Documentation

- [Ngrok Documentation](https://ngrok.com/docs)
- [Xendit Webhooks Guide](https://developers.xendit.co/api-reference/#webhooks)
- [Docker Compose Reference](https://docs.docker.com/compose/)

---

**Last Updated**: November 15, 2025
**Author**: Quantum Sport Backend Team
**Status**: Production Ready for Development Use

## Quick Reference

### Essential Commands

```bash
# Setup
cp .env.example .env  # Add NGROK_AUTHTOKEN

# Start
docker-compose -f docker-compose.yml -f docker-compose.ngrok.yml up -d

# Get URL
docker-compose logs ngrok-monitor

# Test
curl https://your-ngrok-url.ngrok-free.app/webhooks/xendit

# Stop
docker-compose down
```

### Environment Variables

- `NGROK_AUTHTOKEN` - Required, get from ngrok dashboard
- `NGROK_DOMAIN` - Optional, for paid plans only
- `WEBHOOK_BASE_URL` - Auto-updated by ngrok
- `XENDIT_CALLBACK_TOKEN` - Required for webhook security

### Ports

- `8000` - Your application
- `4040` - Ngrok web interface
- `5432/5433` - PostgreSQL
- `6379` - Redis

---

**Need help?** Check the troubleshooting section or contact the development team.
