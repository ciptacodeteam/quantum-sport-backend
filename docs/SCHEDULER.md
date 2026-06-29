# Transaction Expiry Scheduler

## Overview

The scheduler service automatically checks for expired transactions and updates their status. It runs every minute to ensure timely expiration of payments, bookings, and related resources.

## What It Does

The scheduler performs the following tasks every minute:

1. **Expired Payments**
   - Finds payments with `PENDING` status past their `dueDate`
   - Updates payment status to `EXPIRED`
   - Updates related invoice status to `EXPIRED`

2. **Expired Bookings**
   - Cancels bookings associated with expired payments
   - Sets booking status to `CANCELLED`
   - Adds cancellation reason: "Payment expired"
   - Releases all booked slots (court, coach, ballboy) back to available

3. **Expired Class Bookings**
   - Cancels class bookings with expired payments
   - Restores class capacity

4. **Expired Membership Transactions**
   - Deletes unpaid membership user records

5. **Expired Hold Bookings** (Backup Check)
   - Finds bookings with `HOLD` status past their `holdExpiresAt` time
   - Cancels the booking and releases slots
   - Updates related invoices to `EXPIRED`

## Architecture

### Components

- **Scheduler Service** (`src/services/scheduler.service.ts`)
  - Contains the core logic for checking and updating expired transactions
  - Uses BullMQ for job scheduling
  - Runs as a repeatable job every minute

- **Scheduler Worker** (`src/workers/scheduler.worker.ts`)
  - Standalone worker process that executes scheduled jobs
  - Can run independently from the main application server

### Job Flow

```
BullMQ Queue (Redis)
       ↓
Scheduler Worker
       ↓
checkExpiredTransactions()
       ↓
Database Updates (Prisma)
```

## Configuration

### Expiry Times

Current configuration in `src/handlers/checkout.handler.ts`:

- **Booking Hold**: 15 minutes
- **Payment Due Date**: 15 minutes
- **Invoice Due Date**: 15 minutes
- **Xendit Payment Channels**: 15 minutes

### Scheduler Frequency

The scheduler runs every minute:

```typescript
pattern: '* * * * *' // Cron expression: every minute
```

## Running the Scheduler

### Development

#### Option 1: Integrated with Main Server

The scheduler automatically starts when you run the main server:

```bash
bun run dev
```

#### Option 2: Separate Worker Process

Run the scheduler as a standalone worker:

```bash
bun run worker:scheduler
```

### Docker

The scheduler runs as a separate service in Docker Compose:

```bash
docker compose up -d scheduler-worker
```

### Production

Run both the main server and scheduler worker:

```bash
# Terminal 1: Main server
bun run start

# Terminal 2: Scheduler worker
bun run worker:scheduler
```

Or use a process manager like PM2:

```bash
pm2 start ecosystem.config.js
```

## Monitoring

### Logs

The scheduler logs all operations:

- `Running scheduled expiry check...` - Job started
- `Found X expired payments to process` - Payments found
- `Released X slots for booking Y` - Slots released
- `Expiry check completed: X payments, Y hold bookings expired` - Job completed

### BullMQ Dashboard

Monitor jobs using BullMQ Board (optional):

```bash
npm install -g bull-board
```

### Health Check

Check if the scheduler is running:

```bash
# Check Docker container
docker logs scheduler-worker

# Check process
ps aux | grep scheduler.worker
```

## Error Handling

- **Transaction Failures**: Each update is wrapped in a database transaction
- **Retry Logic**: BullMQ automatically retries failed jobs
- **Logging**: All errors are logged with context
- **Graceful Shutdown**: Worker handles SIGTERM and SIGINT signals

## Performance Considerations

1. **Concurrency**: Set to 1 to avoid race conditions
2. **Database Load**: Uses indexed queries for efficient lookups
3. **Transaction Batching**: Each payment/booking is processed in its own transaction
4. **Memory**: Minimal memory footprint, suitable for serverless

## Maintenance

### Clearing Old Jobs

Remove completed jobs from Redis:

```typescript
await schedulerQueue.clean(24 * 60 * 60 * 1000, 'completed') // Remove jobs older than 24 hours
```

### Pausing the Scheduler

```typescript
await schedulerQueue.pause()
```

### Resuming the Scheduler

```typescript
await schedulerQueue.resume()
```

## Troubleshooting

### Scheduler Not Running

1. Check Redis connection:

   ```bash
   redis-cli ping
   ```

2. Check worker logs:

   ```bash
   docker logs scheduler-worker
   ```

3. Verify environment variables:
   - `REDIS_URL` is set correctly
   - `DATABASE_URL` is accessible

### Jobs Not Processing

1. Check if queue is paused:

   ```typescript
   const isPaused = await schedulerQueue.isPaused()
   ```

2. Check for failed jobs:

   ```typescript
   const failed = await schedulerQueue.getFailed()
   ```

3. Restart the worker:
   ```bash
   docker restart scheduler-worker
   ```

## Future Enhancements

- [ ] Add metrics collection (Prometheus/Grafana)
- [ ] Add alerting for stuck jobs
- [ ] Add configurable retry strategies
- [ ] Add job priority levels
- [ ] Add admin API to manually trigger expiry checks
- [ ] Add dashboard for monitoring scheduler status
