import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { err, ok } from '@/lib/response'
import {
  CreateBallboyCostSchema,
  createBallboyCostSchema,
  IdSchema,
  idSchema,
  OverrideSingleBallboyCostSchema,
  overrideSingleBallboyCostSchema,
  SearchQuerySchema,
  searchQuerySchema,
  UpdateBallboyCostSchema,
  updateBallboyCostSchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { Role, SlotType } from 'generated/prisma'
import status from 'http-status'
import {
  overrideStaffHourPrice,
  setStaffPricingRange,
  updateStaffPricing,
} from './costing.service'
import dayjs from 'dayjs'
import { DATETIME_FORMAT } from '@/constants'

export const getBallboyCostHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { isAvailable: 'desc' },
        searchableFields: ['price', 'startAt', 'endAt'],
      })

      const items: any = await db.slot.findMany({
        ...queryOptions,
        where: {
          type: SlotType.BALLBOY,
          ...queryOptions.where,
        },
      })

      for (const item of items) {
        item['startAt'] = dayjs(item.startAt).tz().format(DATETIME_FORMAT)
        item['endAt'] = dayjs(item.endAt).tz().format(DATETIME_FORMAT)
      }

      return c.json(ok(items, 'Ballboy cost endpoint is working'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error fetching ballboy cost: ${error}`)
      throw error
    }
  },
)

export const createBallboyCostHandler = factory.createHandlers(
  zValidator('json', createBallboyCostSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as CreateBallboyCostSchema
      const {
        ballboyId,
        fromDate,
        toDate,
        days,
        happyHourPrice,
        peakHourPrice,
        closedHours,
      } = validated

      const existing = await db.staff.findUnique({
        where: { id: ballboyId },
      })

      if (!existing) {
        throw new NotFoundException('Ballboy not found')
      }

      if (existing.role !== Role.BALLBOY) {
        return c.json(
          err('The specified staff is not a ballboy', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      const success = await setStaffPricingRange({
        staffId: ballboyId,
        type: SlotType.BALLBOY,
        days,
        fromDate,
        happyHourPrice,
        peakHourPrice,
        toDate,
        closedHours,
      })

      if (!success) {
        return c.json(
          err('Failed to set ballboy pricing', status.INTERNAL_SERVER_ERROR),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(
        ok(null, 'Ballboy pricing set successfully'),
        status.CREATED,
      )
    } catch (error) {
      c.var.logger.error(`Error creating ballboy cost: ${error}`)
      throw error
    }
  },
)

export const updateBallboyCostHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', updateBallboyCostSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const validated = c.req.valid('json') as UpdateBallboyCostSchema
      const { date, happyHourPrice, peakHourPrice, closedHours } = validated

      const existing = await db.staff.findUnique({
        where: { id },
      })

      if (!existing) {
        throw new NotFoundException('Ballboy cost schedule not found')
      }

      if (existing.role !== Role.BALLBOY) {
        return c.json(
          err('The specified staff is not a ballboy', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      const updated = await updateStaffPricing({
        staffId: id,
        type: SlotType.BALLBOY,
        date,
        happyHourPrice,
        peakHourPrice,
        closedHours,
      })

      if (!updated) {
        return c.json(
          err('Failed to update ballboy pricing', status.INTERNAL_SERVER_ERROR),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(ok(null, 'Ballboy pricing updated successfully'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error updating ballboy cost: ${error}`)
      throw error
    }
  },
)

export const overrideSingleBallboyCostHandler = factory.createHandlers(
  zValidator('json', overrideSingleBallboyCostSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('json') as OverrideSingleBallboyCostSchema
      const { date, ballboyId, hour, price } = validated

      const existing = await db.staff.findUnique({
        where: { id: ballboyId },
      })

      if (!existing) {
        throw new NotFoundException('Ballboy cost schedule not found')
      }

      if (existing.role !== Role.BALLBOY) {
        return c.json(
          err('The specified staff is not a ballboy', status.BAD_REQUEST),
          status.BAD_REQUEST,
        )
      }

      const updated = await overrideStaffHourPrice({
        staffId: ballboyId,
        type: SlotType.BALLBOY,
        date,
        price,
        hour,
      })

      if (!updated) {
        return c.json(
          err(
            'Failed to override ballboy pricing',
            status.INTERNAL_SERVER_ERROR,
          ),
          status.INTERNAL_SERVER_ERROR,
        )
      }

      return c.json(ok(null, 'Ballboy pricing updated successfully'), status.OK)
    } catch (error) {
      c.var.logger.error(`Error updating ballboy cost: ${error}`)
      throw error
    }
  },
)
