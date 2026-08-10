import { serve } from '@hono/node-server'
import app from './src/app'
import { env } from './src/env'

const port = Number(env.port) || 3000
const schedulerDisabled = process.env.DISABLE_SCHEDULER === 'true'

if (!schedulerDisabled) {
  const { startSchedulerWorker, scheduleExpiryCheck } =
    await import('./src/services/scheduler.service')

  // Start the scheduler worker
  startSchedulerWorker()

  // Schedule the expiry check job
  scheduleExpiryCheck().catch((err) => {
    console.error('Failed to schedule expiry check:', err)
  })
}

serve(
  {
    fetch: app.fetch,
    port: port,
  },
  (info) => {
    console.log(`🚀 Server is running on port http://localhost:${info.port}`)
    console.log(
      schedulerDisabled
        ? `📅 Transaction expiry checker is disabled`
        : `📅 Transaction expiry checker is running`,
    )
  },
)
