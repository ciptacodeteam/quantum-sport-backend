import {
  midtransClientConfigHandler,
  midtransFinishHandler,
  midtransWebhookHandler,
} from '@/handlers/midtrans-webhook.handler'
import { createRouter } from '@/lib/create-app'

const midtransRoute = createRouter()
  .get('/midtrans/client-config', ...midtransClientConfigHandler)
  .get('/payment/finish', ...midtransFinishHandler)
  .post('/payment/finish', ...midtransFinishHandler)
  .post('/webhooks/midtrans', ...midtransWebhookHandler)

export default midtransRoute
