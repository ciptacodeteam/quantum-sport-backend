import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { err, ok } from '@/lib/response'
import {
  CreateCoachCostSchema,
  createCoachCostSchema,
  IdSchema,
  idSchema,
  OverrideSingleCoachCostSchema,
  overrideSingleCoachCostSchema,
  SearchQuerySchema,
  searchQuerySchema,
  UpdateCoachCostSchema,
  updateCoachCostSchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { Role, SlotType } from 'generated/prisma'
import status from 'http-status'
import {
  overrideStaffHourPrice,
  setStaffPricingRange,
  updateStaffPricing,
} from './costing.service'

export const getCoachCostHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { isAvailable: 'desc' },
        searchableFields: ['price', 'startAt', 'endAt'],
      })

      const items = await db.slot.findMany({
        ...queryOptions,
        where: {
          type: SlotType.COACH,
          ...queryOptions.where,
        },
      })
      return c.json(ok(items, 'Coach cost endpoint is working'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error fetching coach cost: ${error}`)
      throw error
    }
  },
)

export const createCoachCostHandler = factory.createHandlers(
  zValidator('json', createCoachCostSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as CreateCoachCostSchema
      const {
        coachId,
        fromDate,
        toDate,
        days,
        happyHourPrice,
        peakHourPrice,
        closedHours,
      } = validated

      const existing = await db.staff.findUnique({
        where: { id: coachId },
      })

      if (!existing) {
        throw new NotFoundException('Coach not found')
      }

      if (existing.role !== Role.COACH) {
        return c.json(
          err('The specified staff is not a coach', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      const success = await setStaffPricingRange({
        staffId: coachId,
        type: SlotType.COACH,
        days,
        fromDate,
        happyHourPrice,
        peakHourPrice,
        toDate,
        closedHours,
      })

      if (!success) {
        return c.json(
          err('Failed to set coach pricing', status.INTERNAL_SERVER_ERROR),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(ok(null, 'Coach pricing set successfully'), status.CREATED)
    } catch (error) {
      c.var.logger.error(`Error creating coach cost: ${error}`)
      throw error
    }
  },
)

export const updateCoachCostHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', updateCoachCostSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const validated = c.req.valid('json') as UpdateCoachCostSchema
      const { date, happyHourPrice, peakHourPrice, closedHours } = validated

      const existing = await db.staff.findUnique({
        where: { id },
      })

      if (!existing) {
        throw new NotFoundException('Coach cost schedule not found')
      }

      if (existing.role !== Role.COACH) {
        return c.json(
          err('The specified staff is not a coach', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      const updated = await updateStaffPricing({
        staffId: id,
        type: SlotType.COACH,
        date,
        happyHourPrice,
        peakHourPrice,
        closedHours,
      })

      if (!updated) {
        return c.json(
          err('Failed to update coach pricing', status.INTERNAL_SERVER_ERROR),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(ok(null, 'Coach pricing updated successfully'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error updating coach cost: ${error}`)
      throw error
    }
  },
)

export const overrideSingleCoachCostHandler = factory.createHandlers(
  zValidator('json', overrideSingleCoachCostSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as OverrideSingleCoachCostSchema
      const { date, coachId, hour, price } = validated

      const existing = await db.staff.findUnique({
        where: { id: coachId },
      })

      if (!existing) {
        throw new NotFoundException('Coach cost schedule not found')
      }

      if (existing.role !== Role.COACH) {
        return c.json(
          err('The specified staff is not a coach', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      const updated = await overrideStaffHourPrice({
        staffId: coachId,
        type: SlotType.COACH,
        date,
        price,
        hour,
      })

      if (!updated) {
        return c.json(
          err('Failed to override coach pricing', status.INTERNAL_SERVER_ERROR),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(ok(null, 'Coach pricing updated successfully'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error updating coach cost: ${error}`)
      throw error
    }
  },
)
