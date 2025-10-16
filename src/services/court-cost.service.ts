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
} from './costing.service'
import { err, ok } from '@/lib/response'
import status from 'http-status'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { NotFoundException } from '@/exceptions'

export const getCourtCostHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { isAvailable: 'desc' },
        searchableFields: ['price', 'startAt', 'endAt'],
      })

      const items = await db.courtCostSchedule.findMany({
        ...queryOptions,
      })
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
      const {
        courtId,
        fromDate,
        toDate,
        days,
        happyHourPrice,
        peakHourPrice,
        closedHours,
      } = validated

      const success = await setCourtPricing({
        courtId,
        days,
        fromDate,
        happyHourPrice,
        peakHourPrice,
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
      const { date, happyHourPrice, peakHourPrice, closedHours } = validated

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
        peakHourPrice,
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
  zValidator('json', overrideSingleCourtCostSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as OverrideSingleCourtCostSchema
      const { date, courtId, hour, price } = validated

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
