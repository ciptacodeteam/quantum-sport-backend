import { isDeployedEnv } from '@/env'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { err, ok } from '@/lib/response'
import { xenditService } from '@/services/xendit.service'
import status from 'http-status'

export const xenditTestHandler = factory.createHandlers(async (c) => {
  if (isDeployedEnv()) {
    return c.json(
      err('Not allowed in production', status.FORBIDDEN),
      status.FORBIDDEN,
    )
  }

  const path = new URL(c.req.url).pathname

  // POST /xendit-test/payment-requests/:id/simulate
  const matchPR = path.match(
    /\/xendit-test\/payment-requests\/([^/]+)\/simulate$/,
  )
  if (c.req.method === 'POST' && matchPR) {
    const prId = matchPR[1]
    const body = (await c.req.json().catch(() => ({}))) as { amount?: number }
    const result = await xenditService.simulatePaymentRequestV3(
      prId,
      body?.amount,
    )
    if (!result) {
      throw new BadRequestException('Simulation request failed')
    }
    return c.json(ok(result, 'Simulation accepted; await webhook result'))
  }

  // POST /xendit-test/payments/:paymentId/simulate
  const matchPayment = path.match(/\/xendit-test\/payments\/([^/]+)\/simulate$/)
  if (c.req.method === 'POST' && matchPayment) {
    const paymentId = matchPayment[1]
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      include: { method: true },
    })
    if (!payment) throw new NotFoundException('Payment not found')

    // Try to get payment_request_id from externalRef or meta
    let paymentRequestId = payment.externalRef
    if (!paymentRequestId && payment.meta) {
      const meta = payment.meta as any
      paymentRequestId = meta?.payment_request_id
    }

    if (!paymentRequestId) {
      // Log payment details for debugging
      c.var.logger.warn(
        `Payment ${paymentId} missing payment_request_id. ` +
          `externalRef: ${payment.externalRef}, ` +
          `meta: ${JSON.stringify(payment.meta)}, ` +
          `paymentMethod: ${payment.method.name}, ` +
          `channel: ${payment.method.channel || 'none'}`,
      )
      throw new BadRequestException(
        `Payment missing external reference (payment_request_id). ` +
          `This payment was not created via Xendit. ` +
          `Payment method: ${payment.method.name}, Channel: ${payment.method.channel || 'none'}`,
      )
    }

    const result = await xenditService.simulatePaymentRequestV3(
      paymentRequestId,
      payment.amount,
    )
    if (!result) {
      throw new BadRequestException('Simulation request failed')
    }
    return c.json(
      ok(
        { paymentRequestId, ...result },
        'Simulation accepted; await webhook result',
      ),
    )
  }

  return c.json(err('Not found', status.NOT_FOUND), status.NOT_FOUND)
})

export default xenditTestHandler
