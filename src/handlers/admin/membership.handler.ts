import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  createMembershipSchema,
  CreateMembershipSchema,
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
  updateMembershipSchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

export const getAllMembershipHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'description'],
      })

      const items = await db.membership.findMany({
        ...queryOptions,
      })
      return c.json(ok(items), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getMembershipItemsHandler: ${error}`)
      throw error
    }
  },
)

export const getMembershipHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const item = await db.membership.findUnique({
        where: { id },
      })

      if (!item) {
        throw new NotFoundException('Membership item not found')
      }

      return c.json(ok(item), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getMembershipHandler: ${error}`)
      throw error
    }
  },
)

export const createMembershipHandler = factory.createHandlers(
  zValidator('json', createMembershipSchema, validateHook),
  async (c) => {
    try {
      const membershipData = c.req.valid(
        'json',
      ) as CreateMembershipSchema

      const newMembership = await db.membership.create({
        data: {
          name: membershipData.name,
          description: membershipData.description,
          price: membershipData.price,
          sessions: membershipData.sessions,
          duration: membershipData.duration,
          sequence: membershipData.sequence,
        },  
      })
     
      return c.json(ok(newMembership), status.CREATED)
    } catch (error) {
      c.var.logger.fatal(`Error in createMembership: ${error}`)
      throw error
    }
  },
)

export const updateMembershipHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', updateMembershipSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const membershipData = c.req.valid(
        'json',
      ) as Partial<CreateMembershipSchema>

      const existingMembership = await db.membership.findUnique({
        where: { id },
      })

      if (!existingMembership) {
        throw new NotFoundException('Membership item not found')
      }

      const updatedMembership = await db.membership.update({
        where: { id },
        data: {
          name: membershipData.name,
          description: membershipData.description,
          price: membershipData.price,
          sessions: membershipData.sessions,
          duration: membershipData.duration,
          sequence: membershipData.sequence,
          isActive: membershipData.isActive,
        },
      })

      return c.json(ok(updatedMembership), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in updateMembershipHandler: ${error}`)
      throw error
    }
  },
)

export const deleteMembershipHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const existingMembership = await db.membership.findUnique({
        where: { id },
      })

      if (!existingMembership) {
        throw new NotFoundException('Membership item not found')
      }

      await db.membership.delete({
        where: { id },
      })

      return c.json(ok(null, 'Membership item deleted successfully'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in deleteMembershipHandler: ${error}`)
      throw error
    }
  },
)