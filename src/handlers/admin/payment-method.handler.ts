import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  CreatePaymentMethodSchema,
  createPaymentMethodSchema,
  IdSchema,
  idSchema,
  SearchQuerySchema,
  searchQuerySchema,
  UpdatePaymentMethodSchema,
  updatePaymentMethodSchema,
} from '@/lib/validation'
import { uploadFile, deleteFile, getFileUrl } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

const PAYMENT_METHOD_LOGO_SUBDIR = 'payment-methods'

export const getAllPaymentMethodsHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { name: 'asc' },
        searchableFields: ['name'],
      })

      const paymentMethods = await db.paymentMethod.findMany({
        ...queryOptions,
      })

      for (const method of paymentMethods) {
        if (method.logo) {
          const logoUrl = await getFileUrl(method.logo)
          method.logo = logoUrl
        }
      }

      return c.json(ok(paymentMethods), status.OK)
    } catch (error) {
      c.var.logger.error(`Error fetching payment methods: ${error}`)
      throw error
    }
  },
)

export const getPaymentMethodHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const paymentMethod = await db.paymentMethod.findUnique({
        where: { id },
      })

      if (!paymentMethod) {
        throw new NotFoundException('Payment method not found')
      }

      return c.json(ok(paymentMethod), status.OK)
    } catch (error) {
      c.var.logger.error(`Error fetching payment method: ${error}`)
      throw error
    }
  },
)

export const createPaymentMethodHandler = factory.createHandlers(
  zValidator('form', createPaymentMethodSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('form') as CreatePaymentMethodSchema
      const { name, logo, fees, isActive, percentage, channel } = validated

      // Check for duplicate name
      const existingPaymentMethod = await db.paymentMethod.findUnique({
        where: { name },
      })

      if (existingPaymentMethod) {
        return c.json(
          { message: 'Payment method with this name already exists' },
          status.CONFLICT,
        )
      }

      let logoUrl: string | undefined = undefined

      if (logo) {
        const uploadedUrl = await uploadFile(logo, {
          subdir: PAYMENT_METHOD_LOGO_SUBDIR,
          unoptimized: true,
        })
        logoUrl = uploadedUrl.relativePath
      }

      const newPaymentMethod = await db.paymentMethod.create({
        data: {
          name,
          logo: logoUrl,
          fees,
          percentage: parseFloat(percentage),
          channel,
          isActive: isActive ?? true,
        },
      })

      return c.json(ok(newPaymentMethod), status.CREATED)
    } catch (error) {
      c.var.logger.error(`Error creating payment method: ${error}`)
      throw error
    }
  },
)

export const updatePaymentMethodHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updatePaymentMethodSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const validated = c.req.valid('form') as UpdatePaymentMethodSchema
      const { name, logo, fees, isActive, channel, percentage } = validated

      const existingPaymentMethod = await db.paymentMethod.findUnique({
        where: { id },
      })

      if (!existingPaymentMethod) {
        throw new NotFoundException('Payment method not found')
      }

      // Check for duplicate name if name is being updated
      if (name && name !== existingPaymentMethod.name) {
        const duplicateName = await db.paymentMethod.findUnique({
          where: { name },
        })

        if (duplicateName) {
          return c.json(
            { message: 'Payment method with this name already exists' },
            status.CONFLICT,
          )
        }
      }

      let logoUrl = existingPaymentMethod.logo

      if (logo) {
        // Delete old logo if it exists
        if (existingPaymentMethod.logo) {
          await deleteFile(existingPaymentMethod.logo)
        }

        // Upload new logo
        const uploadedUrl = await uploadFile(logo, {
          subdir: PAYMENT_METHOD_LOGO_SUBDIR,
        })
        logoUrl = uploadedUrl.relativePath
      }

      const isPaymentMethodActive =
        isActive !== undefined
          ? Boolean(isActive)
          : existingPaymentMethod.isActive

      const updatedPaymentMethod = await db.paymentMethod.update({
        where: { id },
        data: {
          name: name ?? undefined,
          logo: logoUrl,
          fees: fees ?? undefined,
          percentage: percentage ? parseFloat(percentage) : undefined,
          channel: channel ?? undefined,
          isActive: isPaymentMethodActive,
        },
      })

      if (updatedPaymentMethod.logo) {
        const logoUrl = await getFileUrl(updatedPaymentMethod.logo)
        updatedPaymentMethod.logo = logoUrl
      }

      return c.json(ok(updatedPaymentMethod), status.OK)
    } catch (error) {
      c.var.logger.error(`Error updating payment method: ${error}`)
      throw error
    }
  },
)

export const deletePaymentMethodHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const existingPaymentMethod = await db.paymentMethod.findUnique({
        where: { id },
        include: {
          payments: true,
        },
      })

      if (!existingPaymentMethod) {
        throw new NotFoundException('Payment method not found')
      }

      // Delete logo if it exists
      if (existingPaymentMethod.logo) {
        await deleteFile(existingPaymentMethod.logo)
      }

      if (existingPaymentMethod.payments.length > 0) {
        await db.paymentMethod.update({
          where: { id },
          data: { isActive: false },
        })

        return c.json(
          { message: 'Cannot delete payment method with associated payments' },
          status.BAD_REQUEST,
        )
      }

      await db.paymentMethod.delete({
        where: { id },
      })

      return c.json(ok(null, 'Payment method deleted successfully'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error deleting payment method: ${error}`)
      throw error
    }
  },
)
