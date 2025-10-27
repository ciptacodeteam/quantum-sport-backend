import { xenditWebhookHandler } from '@/handlers/xendit-webhook.handler'
import { createRouter } from '@/lib/create-app'

const xenditWebhookRoute = createRouter()
  .basePath('/webhooks/xendit')
  .post('/', ...xenditWebhookHandler)

export default xenditWebhookRoute

