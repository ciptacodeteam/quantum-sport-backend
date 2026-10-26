import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { getFileUrl } from '@/services/upload.service'
import status from 'http-status'

export const getCustomerPaymentMethodsHandler = factory.createHandlers(
  async (c) => {
    try {
      const paymentMethods = await db.paymentMethod.findMany({
        where: {
          isActive: true,
          OR: [
            { channel: 'CARDS' },
            { channel: 'QRIS' },
            { channel: 'QR' },
            { channel: { endsWith: 'VIRTUAL_ACCOUNT' } },
          ],
        },
        orderBy: { sequence: 'asc' },
      })

      const enrichedPaymentMethods = await Promise.all(
        paymentMethods.map(async (method) => {
          if (!method.logo) {
            return method
          }

          const logoUrl = await getFileUrl(method.logo)
          return {
            ...method,
            logo: logoUrl,
          }
        }),
      )

      return c.json(ok(enrichedPaymentMethods), status.OK)
    } catch (error) {
      c.var.logger.fatal(
        `Error fetching payment methods for customer: ${error}`,
      )
      throw error
    }
  },
)
