import { rollingCourtPricingSchema } from '@/lib/rolling-booking-window'
import { saveRollingCourtSchedule } from '@/services/rolling-court-schedule.service'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import {
  CreateCourtCostSchema,
  createCourtCostSchema,
  IdSchema,
  idSchema,
  OverrideSingleCourtCostSchema,
  overrideSingleCourtCostSchema,
  SearchQuerySchema,
  searchQuerySchema,
  UpdateCourtCostSchema,
  updateCourtCostSchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import {
  overrideSingleCourtHourPrice,
  setCourtPricing,
  updateCourtPricing,
} from '../../services/costing.service'
import { err, ok } from '@/lib/response'
import status from 'http-status'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { BadRequestException, NotFoundException } from '@/exceptions'
import dayjs from 'dayjs'
import { DATETIME_FORMAT } from '@/constants'

export const getCourtCostHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { isAvailable: 'desc' },
        searchableFields: ['price', 'startAt', 'endAt'],
      })

      const items: any = await db.courtCostSchedule.findMany({
        ...queryOptions,
      })

      for (const item of items) {
        item['startAt'] = dayjs(item.startAt)
          .startOf('day')
          .format(DATETIME_FORMAT)
        item['endAt'] = dayjs(item.endAt).endOf('day').format(DATETIME_FORMAT)
      }

      return c.json(ok(items, 'Court cost endpoint is working'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error fetching court cost: ${error}`)
      throw error
    }
  },
)

export const createCourtCostHandler = factory.createHandlers(
  zValidator('json', createCourtCostSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as CreateCourtCostSchema
      const court = await db.court.findUnique({
        where: { id: validated.courtId },
      })
      if (!court) throw new NotFoundException('Court not found')
      if (court.bookingWindowMonths)
        throw new BadRequestException(
          'Gunakan pengaturan jadwal berjalan untuk lapangan ini.',
        )
      const {
        courtId,
        fromDate,
        toDate,
        days,
        happyHourPrice,
        happyHourDiscountPrice,
        peakHourPrice,
        peakHourDiscountPrice,
        closedHours,
      } = validated

      const success = await setCourtPricing({
        courtId,
        days,
        fromDate,
        happyHourPrice,
        happyHourDiscountPrice,
        peakHourPrice,
        peakHourDiscountPrice,
        toDate,
        closedHours,
      })

      if (!success) {
        return c.json(
          err('Failed to set court pricing', status.INTERNAL_SERVER_ERROR),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(ok(null, 'Court pricing set successfully'), status.CREATED)
    } catch (error) {
      c.var.logger.error(`Error creating court cost: ${error}`)
      throw error
    }
  },
)

export const updateCourtCostHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', updateCourtCostSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const validated = c.req.valid('json') as UpdateCourtCostSchema
      const {
        date,
        happyHourPrice,
        happyHourDiscountPrice,
        peakHourPrice,
        peakHourDiscountPrice,
        closedHours,
      } = validated

      const existing = await db.courtCostSchedule.findUnique({
        where: { id },
      })

      if (!existing) {
        throw new NotFoundException('Court cost schedule not found')
      }

      const updated = await updateCourtPricing({
        courtId: id,
        date,
        happyHourPrice,
        happyHourDiscountPrice,
        peakHourPrice,
        peakHourDiscountPrice,
        closedHours,
      })

      if (!updated) {
        return c.json(
          err('Failed to update court pricing', status.INTERNAL_SERVER_ERROR),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(ok(null, 'Court pricing updated successfully'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error updating court cost: ${error}`)
      throw error
    }
  },
)

export const overrideSingleCourtCostHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', overrideSingleCourtCostSchema, validateHook),
  async (c) => {
    try {
      const { id: courtId } = c.req.valid('param') as IdSchema
      const validated = c.req.valid('json') as OverrideSingleCourtCostSchema
      const { date, hour, price, discountPrice } = validated

      const existing = await db.courtCostSchedule.findUnique({
        where: { id: courtId },
      })

      if (!existing) {
        throw new NotFoundException('Court cost schedule not found')
      }

      const updated = await overrideSingleCourtHourPrice({
        courtId,
        date,
        price,
        discountPrice,
        hour,
      })

      if (!updated) {
        return c.json(
          err('Failed to override court pricing', status.INTERNAL_SERVER_ERROR),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(ok(null, 'Court pricing updated successfully'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error updating court cost: ${error}`)
      throw error
    }
  },
)

export const saveRollingCourtScheduleHandler = factory.createHandlers(
  zValidator('json', rollingCourtPricingSchema, validateHook),
  async (c) => {
    const result = await saveRollingCourtSchedule(c.req.valid('json'))
    return c.json(ok(result, 'Jadwal berjalan berhasil disimpan'), status.OK)
  },
)
