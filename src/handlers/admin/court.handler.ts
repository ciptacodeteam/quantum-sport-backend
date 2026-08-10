import { DATETIME_FORMAT } from '@/constants'
import { COURT_SUBDIR } from '@/config'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  AvailableCourtSlotsQuerySchema,
  availableCourtSlotsQuerySchema,
  BulkUpdateCourtSlotPricingSchema,
  bulkUpdateCourtSlotPricingSchema,
  CreateCourtSchema,
  createCourtSchema,
  IdSchema,
  idSchema,
  searchQuerySchema,
  SearchQuerySchema,
  UpdateCourtSchema,
  updateCourtSchema,
  UpdateCourtSlotAvailabilitySchema,
  updateCourtSlotAvailabilitySchema,
  UpdateSlotPricingSchema,
  updateSlotPricingSchema,
} from '@/lib/validation'
import { deleteFile, getFileUrl, uploadFile } from '@/services/upload.service'
import {
  bulkUpdateCourtSlotPricing,
  updateSlotPricing,
} from '@/services/costing.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { BookingStatus, SlotType } from '@prisma/client'
import dayjs from 'dayjs'
import z from 'zod'

export const getAllCourtHandler = factory.createHandlers(
  zValidator(
    'query',
    searchQuerySchema.extend({
      courtSport: z.enum(['PADEL', 'TENNIS'] as const).optional(),
    }),
    validateHook,
  ),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema & {
        courtSport?: 'PADEL' | 'TENNIS'
      }
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'description'],
      })

      const items = await db.court.findMany({
        ...queryOptions,
        where: {
          ...(query.courtSport ? { sport: query.courtSport } : {}),
          ...queryOptions.where,
        },
      })

      for (const item of items) {
        if (item.image) {
          const imageUrl = await getFileUrl(item.image)
          item.image = imageUrl
        }
      }

      return c.json(ok(items), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getCourtItemsHandler: ${error}`)
      throw error
    }
  },
)

export const getCourtHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const item = await db.court.findUnique({
        where: { id },
        include: {
          bookingDetail: true,
          costSchedules: true,
          slot: true,
        },
      })

      if (!item) {
        throw new NotFoundException('Court item not found')
      }

      if (item.image) {
        item.image = await getFileUrl(item.image)
      }

      return c.json(ok(item), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getCourtHandler: ${error}`)
      throw error
    }
  },
)

export const createCourtHandler = factory.createHandlers(
  zValidator('form', createCourtSchema, validateHook),
  async (c) => {
    try {
      const body = c.req.valid('form') as CreateCourtSchema
      const { name, description, image, isActive, sport } = body

      let imageUrl: string | undefined

      if (image) {
        const uploaded = await uploadFile(image, {
          subdir: COURT_SUBDIR,
        })
        imageUrl = uploaded.relativePath
      }

      const newItem = await db.court.create({
        data: {
          name,
          description,
          image: imageUrl,
          sport,
          isActive: isActive ?? false,
        },
      })

      if (newItem.image) {
        newItem.image = await getFileUrl(newItem.image)
      }

      return c.json(ok(newItem), status.CREATED)
    } catch (error) {
      c.var.logger.fatal(`Error in createCourt: ${error}`)
      throw error
    }
  },
)

export const updateCourtHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updateCourtSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const body = c.req.valid('form') as UpdateCourtSchema
      const { name, description, image, isActive, sport } = body

      const existingItem = await db.court.findUnique({
        where: { id },
      })

      if (!existingItem) {
        throw new NotFoundException('Court item not found')
      }

      let imageUrl = existingItem.image

      if (image) {
        if (existingItem.image) {
          const deleted = await deleteFile(existingItem.image)
          if (deleted) {
            c.var.logger.info(
              `Old image deleted for court ID: ${existingItem.id}`,
            )
          } else {
            c.var.logger.warn(
              `Failed to delete old image for court ID: ${existingItem.id}`,
            )
          }
        }

        const uploaded = await uploadFile(image, {
          subdir: COURT_SUBDIR,
        })
        imageUrl = uploaded.relativePath
      }

      const updatedItem = await db.court.update({
        where: { id },
        data: {
          name: name ?? existingItem.name,
          description: description ?? existingItem.description,
          image: imageUrl,
          sport: sport ?? existingItem.sport,
          isActive: Boolean(
            isActive !== undefined ? isActive : existingItem.isActive,
          ),
        },
      })

      updatedItem.image = await getFileUrl(imageUrl)

      return c.json(ok(updatedItem), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in updateCourtHandler: ${error}`)
      throw error
    }
  },
)

export const deleteCourtHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const existingItem = await db.court.findUnique({
        where: { id },
      })

      if (!existingItem) {
        throw new NotFoundException('Court item not found')
      }

      const isAlreadyBooked = await db.bookingDetail.findFirst({
        where: {
          courtId: id,
          booking: {
            status: {
              not: BookingStatus.CANCELLED,
            },
          },
        },
      })

      if (isAlreadyBooked) {
        throw new BadRequestException(
          'Cannot delete court with existing bookings',
        )
      }

      if (existingItem.image) {
        const deleted = await deleteFile(existingItem.image)
        if (deleted) {
          c.var.logger.info(`Image deleted for court ID: ${existingItem.id}`)
        } else {
          c.var.logger.warn(
            `Failed to delete image for court ID: ${existingItem.id}`,
          )
        }
      }

      await db.court.delete({
        where: { id },
      })

      return c.json(ok(null, 'Court item deleted successfully'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in deleteCourtHandler: ${error}`)
      throw error
    }
  },
)

export const getAvailableCourtSlotsHandler = factory.createHandlers(
  zValidator('query', availableCourtSlotsQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as AvailableCourtSlotsQuerySchema & {
        courtId?: string
        courtSport?: 'PADEL' | 'TENNIS'
      }

      const where: any = {
        type: SlotType.COURT,
        isAvailable: true,
        bookingDetails: {
          none: {
            booking: {
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
          },
        },
        court: {
          is: {
            isActive: true,
            ...(query.courtSport ? { sport: query.courtSport } : {}),
          },
        },
      }

      if (query.courtId) {
        where.courtId = query.courtId
      }

      if (query.startAt && query.endAt) {
        const startAt = dayjs(query.startAt).startOf('day').toDate()
        const endAt = dayjs(query.endAt).endOf('day').toDate()

        where.AND = [
          {
            startAt: {
              lt: endAt,
            },
          },
          {
            endAt: {
              gt: startAt,
            },
          },
        ]
      }

      const slots = await db.slot.findMany({
        where,
        orderBy: {
          startAt: 'asc',
        },
        include: {
          court: true,
        },
      })

      // Transform court images
      for (const slot of slots) {
        if (slot.court?.image) {
          slot.court.image = await getFileUrl(slot.court.image)
        }
      }

      const formattedSlots = slots.map((slot) => ({
        ...slot,
        normalPrice: slot.price,
        discountPrice: slot.discountPrice,
        startAt: dayjs(slot.startAt).format(DATETIME_FORMAT),
        endAt: dayjs(slot.endAt).format(DATETIME_FORMAT),
        createdAt: dayjs(slot.createdAt).format(DATETIME_FORMAT),
        updatedAt: dayjs(slot.updatedAt).format(DATETIME_FORMAT),
      }))

      return c.json(ok(formattedSlots), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getAvailableCourtSlotsHandler: ${error}`)
      throw error
    }
  },
)

export const getCostHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const courtCostSlot = await db.$queryRaw`
        SELECT 
          s."startAt"::date AS date,
          json_agg(
            json_build_object(
              'id', s.id,
              'courtId', s."courtId",
              'startAt', s."startAt",
              'endAt', s."endAt",
              'price', s.price,
              'discountPrice', s."discountPrice",
              'isAvailable', s."isAvailable",
              'createdAt', s."createdAt",
              'updatedAt', s."updatedAt"
            )
          ) AS slots
        FROM slots AS s
        WHERE s."courtId" = ${id}
        GROUP BY date
        ORDER BY date DESC
      `

      if (!courtCostSlot) {
        throw new NotFoundException('Court cost slot not found')
      }

      return c.json(ok(courtCostSlot), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getCostHandler: ${error}`)
      throw error
    }
  },
)

export const updateCourtSlotAvailabilityHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', updateCourtSlotAvailabilitySchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const { isAvailable } = c.req.valid(
        'json',
      ) as UpdateCourtSlotAvailabilitySchema

      // Check if slot exists and is a court slot
      const slot = await db.slot.findUnique({
        where: { id },
        include: {
          bookingDetails: {
            where: {
              booking: {
                status: {
                  not: BookingStatus.CANCELLED,
                },
              },
            },
          },
        },
      })

      if (!slot) {
        throw new NotFoundException('Court slot not found')
      }

      if (slot.type !== SlotType.COURT) {
        throw new BadRequestException('Slot is not a court slot')
      }

      // Prevent disabling slots that have active bookings
      if (!isAvailable && slot.bookingDetails.length > 0) {
        throw new BadRequestException(
          'Cannot disable court slot with active bookings',
        )
      }

      const updatedSlot = await db.slot.update({
        where: { id },
        data: {
          isAvailable,
        },
        include: {
          court: true,
        },
      })

      // Transform court image if exists
      if (updatedSlot.court?.image) {
        updatedSlot.court.image = await getFileUrl(updatedSlot.court.image)
      }

      const formattedSlot = {
        ...updatedSlot,
        startAt: dayjs(updatedSlot.startAt).format(DATETIME_FORMAT),
        endAt: dayjs(updatedSlot.endAt).format(DATETIME_FORMAT),
        createdAt: dayjs(updatedSlot.createdAt).format(DATETIME_FORMAT),
        updatedAt: dayjs(updatedSlot.updatedAt).format(DATETIME_FORMAT),
      }

      return c.json(
        ok(
          formattedSlot,
          `Court slot ${isAvailable ? 'enabled' : 'disabled'} successfully`,
        ),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in updateCourtSlotAvailabilityHandler: ${error}`,
      )
      throw error
    }
  },
)

export const updateSlotPricingHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', updateSlotPricingSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const { price, discountPrice = 0 } = c.req.valid(
        'json',
      ) as UpdateSlotPricingSchema

      // Verify slot exists
      const slot = await db.slot.findUnique({
        where: { id },
      })

      if (!slot) {
        throw new NotFoundException('Slot not found')
      }

      if (slot.type !== SlotType.COURT) {
        throw new BadRequestException('Slot is not a court slot')
      }

      const updated = await updateSlotPricing({
        slotId: id,
        price,
        discountPrice,
      })

      if (!updated) {
        throw new BadRequestException(
          'Failed to update slot pricing (slot may have active bookings)',
        )
      }

      const updatedSlot = await db.slot.findUnique({
        where: { id },
        include: {
          court: true,
        },
      })

      const formattedSlot = {
        ...updatedSlot,
        startAt: dayjs(updatedSlot?.startAt).format(DATETIME_FORMAT),
        endAt: dayjs(updatedSlot?.endAt).format(DATETIME_FORMAT),
        createdAt: dayjs(updatedSlot?.createdAt).format(DATETIME_FORMAT),
        updatedAt: dayjs(updatedSlot?.updatedAt).format(DATETIME_FORMAT),
      }

      return c.json(
        ok(formattedSlot, 'Slot pricing updated successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in updateSlotPricingHandler: ${error}`)
      throw error
    }
  },
)

export const bulkUpdateCourtSlotPricingHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', bulkUpdateCourtSlotPricingSchema, validateHook),
  async (c) => {
    try {
      const { id: courtId } = c.req.valid('param') as IdSchema
      const payload = c.req.valid('json') as BulkUpdateCourtSlotPricingSchema

      const court = await db.court.findUnique({
        where: { id: courtId },
        select: { id: true },
      })

      if (!court) {
        throw new NotFoundException('Court item not found')
      }

      const result = await bulkUpdateCourtSlotPricing({
        courtId,
        ...payload,
      })

      return c.json(
        ok(result, 'Bulk court slot pricing updated successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in bulkUpdateCourtSlotPricingHandler: ${error}`)
      throw error
    }
  },
)
