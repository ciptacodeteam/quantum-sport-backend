# BullMQ Setup & Integration Guide

This document provides a comprehensive overview of how BullMQ is integrated into the Quantum Sport backend for async email queue processing with password reset functionality.

## Overview

**BullMQ** is a robust, feature-rich library for job queuing in Node.js. We use it to handle asynchronous email sending with automatic retries, exponential backoff, and Redis persistence.

### Key Benefits

- ✅ Async email processing (non-blocking request handling)
- ✅ Automatic retry logic (3 attempts with exponential backoff: 2s → 4s → 8s)
- ✅ Persistent job storage (Redis-backed)
- ✅ Job tracking and monitoring capabilities
- ✅ Graceful worker shutdown handling
- ✅ Concurrent job processing (5 emails at a time)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   HTTP Request                              │
│            (Password Reset Endpoint)                        │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│         Email Handler (handler/auth/password-reset.handler) │
│                                                              │
│  1. Validate token/password                                 │
│  2. Hash password + update DB                               │
│  3. Queue email job (async)                                 │
│  4. Return success immediately                              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│            Email Queue Service                              │
│  (services/email-queue.service)                             │
│                                                              │
│  Adds job to BullMQ queue:                                  │
│  - Job ID: email-{timestamp}-{random}                       │
│  - Retries: 3 (exponential backoff)                         │
│  - Storage: Redis                                           │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼ (via Redis connection)
        ┌────────────────────┐
        │  Redis Queue       │
        │  (Persistent)      │
        └────────┬───────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│            Email Worker Process                             │
│  (workers/email.worker.ts)                                  │
│                                                              │
│  1. Poll Redis for jobs                                     │
│  2. Process email (concurrent: 5 at a time)                 │
│  3. Send via SMTP (Nodemailer)                              │
│  4. Mark as complete or retry                               │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

### Core Services

#### `src/services/email-queue.service.ts`

BullMQ queue management and initialization

**Exports:**

- `EmailJob` interface - Job data structure
- `emailQueue` - Global queue instance
- `queueEmail(jobData)` - Add job to queue
- `getEmailQueueStats()` - Get queue statistics
- `initEmailWorker(processor)` - Initialize worker process
- `closeEmailQueue()` - Gracefully close queue

**Configuration:**

```typescript
Queue options:
- attempts: 3 (retry 3 times)
- backoff: exponential (2s, 4s, 8s delays)
- removeOnComplete: true (clean successful jobs)
- removeOnFail: false (keep failed jobs for debugging)
```

#### `src/services/email.service.ts`

SMTP configuration and email template rendering

**Exports:**

- `createTransporter()` - SMTP transporter
- `sendEmail(to, subject, html)` - Direct email send
- `sendTemplatedEmail(to, template, variables)` - Template rendering + send

**Supported Templates:**

- `passwordReset` - Password reset confirmation email
- `verificationCode` - 6-digit OTP verification
- `welcome` - Onboarding/welcome email

#### `src/services/password-reset.service.ts`

Password reset token lifecycle management

**Exports:**

- `generatePasswordResetToken()` - Generate crypto token
- `createPasswordResetToken(userId)` - Store token in DB (24h expiry)
- `verifyPasswordResetToken(token, userId)` - Validate token
- `invalidatePasswordResetToken(token)` - Mark token as used
- `getValidPasswordResetToken(token)` - Retrieve with validation
- `buildPasswordResetLink(token, baseUrl)` - URL construction

### Worker Process

#### `src/workers/email.worker.ts`

Background job processor that consumes email queue jobs

**Process Flow:**

1. Initializes BullMQ worker with `emailProcessor` function
2. Listens on Redis for new jobs
3. Processes jobs concurrently (5 at a time)
4. Attempts to send email via SMTP
5. Retries on failure (exponential backoff)
6. Handles graceful shutdown (SIGTERM, SIGINT)

**Running the Worker:**

```bash
# Development (via docker-compose)
docker-compose up email-worker

# Manual
npm run worker:email

# Production (Vercel doesn't support long-running workers, use external queue processor)
```

### Routes

#### `src/routes/password-reset.route.ts`

Public password reset endpoints

**Endpoints:**

1. **POST /auth/password-reset/request-reset**
   - User-initiated password reset request
   - Body: `{ email }`
   - Returns: Generic success (no user enumeration)
   - Sends: Reset link to verified email

2. **POST /auth/password-reset** (or `/auth/password/reset`)
   - Execute password reset with token
   - Body: `{ token, newPassword, confirmPassword }`
   - Returns: Success with user info
   - Queues: Confirmation email

3. **GET /auth/password-reset/verify** (or `/auth/password/reset/verify`)
   - Verify if reset token is valid
   - Query: `?token={token}`
   - Returns: `{ valid, userId?, userName?, expiresAt? }`

### Handlers

#### `src/handlers/auth/password-reset.handler.ts`

Handler functions for password reset endpoints

**Handlers:**

- `resetPasswordWithTokenHandler` - Execute password reset
- `verifyResetTokenHandler` - Check token validity
- `requestPasswordResetHandler` - Request password reset

#### `src/handlers/admin/user.handler.ts::sendResetPasswordLinkHandler`

Admin endpoint to trigger password reset for any user

**Endpoint:** `POST /admin/users/:id/send-reset-password`
**Flow:**

1. Admin initiates reset for user ID
2. System tries email (if verified) → queue email job
3. Falls back to phone (if email fails)
4. Returns success with channels used

## Database Schema

### PasswordResetToken Model

```prisma
model PasswordResetToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  usedAt    DateTime?     // null = unused, set = already used
  createdAt DateTime

  user User @relation(...onDelete: Cascade)

  @@index([token])        // Fast lookup by token
  @@index([userId])       // Fast lookup by user
  @@index([expiresAt])    // Fast expiry cleanup
}
```

**Token Lifecycle:**

1. **Creation**: `createPasswordResetToken()` → Token stored with 24h expiry
2. **Validation**: `verifyPasswordResetToken()` → Check expiry + not used
3. **Usage**: `invalidatePasswordResetToken()` → Set `usedAt` timestamp
4. **Security**: Invalidate ALL user's tokens on successful reset

## Environment Configuration

### Required Variables

```env
# Redis Connection
REDIS_URL=redis://localhost:6379

# SMTP Configuration
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_username
SMTP_PASS=your_password
SMTP_FROM=noreply@quantumsport.com

# Base URLs
BASE_URL=http://localhost:3000
BASE_FRONTEND_URL=http://localhost:3001

# Password Security
PWD_PEPPER=your_secret_pepper_value

# JWT Configuration
JWT_SECRET=your_jwt_secret
JWT_EXPIRE=7d

# Database
DATABASE_URL=postgresql://user:pass@localhost:5433/quantum_sport
```

### SMTP Providers

**Development (Mailtrap):**

- Host: `smtp.mailtrap.io`
- Port: `2525` (non-TLS) or `465` (TLS)
- Free tier: 100 emails/month

**Production (AWS SES):**

- Host: `email-smtp.{region}.amazonaws.com`
- Port: `587` or `465`
- Requires AWS credentials

**Production (SendGrid):**

- Host: `smtp.sendgrid.net`
- Port: `587`
- Username: `apikey`
- Password: Your SendGrid API key

## Docker Setup

### Services

The `docker-compose.yml` includes:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ['5433:5432']
    environment: DATABASE_URL
    volumes: [postgres-data]

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    volumes: [redis-data]

  app:
    build: .
    ports: ['8000:3000']
    depends_on: [postgres, redis]
    environment: All .env variables

  email-worker:
    build: .
    command: npm run worker:email
    depends_on: [postgres, redis]
    environment: All .env variables
    restart: unless-stopped

  prisma-studio:
    build: .
    command: npx prisma studio
    ports: ['5555:5555']
    depends_on: [postgres]
    environment: DATABASE_URL
```

### Running Locally

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env.local

# Start all services
docker-compose up

# View logs
docker-compose logs -f email-worker

# Stop services
docker-compose down
```

## Package Dependencies

Key npm packages for BullMQ integration:

```json
{
  "bullmq": "^5.10.1", // Job queue library
  "ioredis": "^5.3.7", // Redis client
  "redis": "^4.7.0", // Redis connection pool
  "nodemailer": "^6.9.10", // SMTP email sender
  "argon2": "^0.32.1", // Password hashing
  "zod": "^3.24.0", // Schema validation
  "@hono/zod-validator": "^0.5.0" // Hono + Zod integration
}
```

## Usage Examples

### Queue Email from Handler

```typescript
import { queueEmail } from '@/services/email-queue.service'

// Queue password reset email
await queueEmail({
  to: 'user@example.com',
  subject: 'Reset Your Password',
  template: 'passwordReset',
  variables: {
    name: 'John Doe',
    resetLink: 'https://app.com/reset?token=abc123',
    expiresIn: '24 hours',
    actionUrl: 'https://app.com/reset?token=abc123',
  },
})
```

### Get Queue Statistics

```typescript
import { getEmailQueueStats } from '@/services/email-queue.service'

const stats = await getEmailQueueStats()
console.log(stats)
// {
//   active: 2,
//   completed: 150,
//   failed: 1,
//   waiting: 5,
//   delayed: 0,
//   isPaused: false
// }
```

### Create Password Reset Token

```typescript
import {
  createPasswordResetToken,
  buildPasswordResetLink,
} from '@/services/password-reset.service'

const { token, expiresIn } = await createPasswordResetToken(userId)
const resetLink = buildPasswordResetLink(token, 'https://app.com')
// resetLink = 'https://app.com/auth/password/reset?token=...'
```

### Validate Reset Token

```typescript
import { verifyPasswordResetToken } from '@/services/password-reset.service'

const isValid = await verifyPasswordResetToken(token, userId)
if (!isValid) {
  throw new BadRequestException('Invalid or expired token')
}
```

## Monitoring & Debugging

### Check Queue Status

```bash
# While containers are running
docker-compose exec app npm run queue:status
```

### View Failed Jobs

```typescript
// In app handler
import { emailQueue } from '@/services/email-queue.service'

const failed = await emailQueue.getFailed()
console.log(failed)
```

### Enable Debug Logging

```typescript
// In development, all jobs are logged via pino
// Check logs in storage/logs/
```

### Clear Queue (Development Only)

```typescript
import { emailQueue } from '@/services/email-queue.service'

// Remove all jobs
await emailQueue.clean(0, 'active')
await emailQueue.clean(0, 'completed')
await emailQueue.clean(0, 'failed')
```

## Best Practices

### 1. Always Use Template Variables

```typescript
// ✅ Good - Variables are escaped/sanitized
variables: { name: user.name, link: resetLink }

// ❌ Avoid - XSS vulnerability
html: `<p>Hello ${user.name}</p>`
```

### 2. Handle Email Failures Gracefully

```typescript
// ✅ Good - Queue is best-effort
try {
  await queueEmail(...)
} catch (error) {
  logger.warn('Email queue failed, but request continues')
}

// ❌ Avoid - Blocking user request
await sendEmail(...) // Synchronous, blocks request
```

### 3. Validate Tokens Before Returning Success

```typescript
// ✅ Good - Verify before generating
const isValid = await verifyPasswordResetToken(token)
if (!isValid) throw new BadRequestException('Invalid token')

// ❌ Avoid - Trust unverified tokens
const token = req.query.token
```

### 4. Implement Expiry Cleanup

```typescript
// Scheduled job to clean expired tokens (optional, DB TTL works too)
const expired = await db.passwordResetToken.deleteMany({
  where: { expiresAt: { lt: new Date() } },
})
```

## Troubleshooting

### Issue: Jobs not being processed

**Cause:** Email worker not running
**Solution:** `docker-compose up email-worker` or check logs

### Issue: Redis connection refused

**Cause:** Redis service not running
**Solution:** `docker-compose up redis`

### Issue: Email not being sent

**Cause 1:** Invalid SMTP credentials
**Solution:** Check `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` in `.env`

**Cause 2:** Firewall blocking SMTP port
**Solution:** Use SMTP port 587 or 465 (TLS), not 25

### Issue: Tokens not working

**Cause:** Token expired or already used
**Solution:** Check `usedAt` and `expiresAt` in database

### Issue: Type errors with email sending

**Cause:** `user.email` can be null in User model
**Solution:** Always check `if (user.email)` before queuing

## Related Documentation

- [EMAIL_QUEUE.md](./EMAIL_QUEUE.md) - Detailed email queue implementation
- [PASSWORD_RESET.md](./PASSWORD_RESET.md) - Password reset flow and token lifecycle
- [DOCKER_EMAIL_WORKER.md](./DOCKER_EMAIL_WORKER.md) - Docker worker operations
- [XENDIT_PAYMENT_INTEGRATION.md](./payments/XENDIT_PAYMENT_INTEGRATION.md) - Payment integration (similar async pattern)

## Next Steps

1. ✅ All infrastructure in place
2. ✅ Routes and handlers implemented
3. ✅ Database schema updated
4. ⏭️ **Frontend:** Implement password reset UI
5. ⏭️ **Testing:** Integration tests for email flow
6. ⏭️ **Monitoring:** Add Sentry/monitoring for failed jobs
7. ⏭️ **Analytics:** Track email sending metrics

---

**Last Updated:** November 2025
**Version:** 1.0.0
