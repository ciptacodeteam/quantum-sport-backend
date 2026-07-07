import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import { formatPhone, generateInvoiceNumber } from '@/lib/utils'
import {
  createMembershipSchema,
  CreateMembershipSchema,
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
  UpdateMembershipSchema,
  updateMembershipSchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import { CourtSport, PaymentStatus } from '@prisma/client'
import dayjs from 'dayjs'
import status from 'http-status'
import { z } from 'zod'
import { hashPassword } from '@/lib/password'

const membershipQuerySchema = searchQuerySchema.extend({
  sport: z.nativeEnum(CourtSport).optional(),
})

export const getAllMembershipHandler = factory.createHandlers(
  zValidator('query', membershipQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema & {
        sport?: CourtSport
      }
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { sequence: 'asc' },
        searchableFields: ['name', 'description'],
      })

      const items = await db.membership.findMany({
        ...queryOptions,
        where: {
          ...queryOptions.where,
          ...(query.sport ? { sport: query.sport } : {}),
        },
        include: {
          benefits: true,
        },
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
        include: {
          benefits: true,
        },
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
      const membershipData = c.req.valid('json') as CreateMembershipSchema

      const newMembership = await db.membership.create({
        data: {
          name: membershipData.name,
          description: membershipData.description,
          price: membershipData.price,
          content: membershipData.content,
          contentHtml: membershipData.contentHtml,
          sport: membershipData.sport,
          type: membershipData.type,
          sessions: membershipData.sessions,
          duration: membershipData.duration,
          sequence: membershipData.sequence,
          isActive: membershipData.isActive,
          benefits: {
            createMany: {
              data: (membershipData.benefits || []).map((benefit) => ({
                benefit: benefit,
              })),
              skipDuplicates: true,
            },
          },
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
      ) as Partial<UpdateMembershipSchema>

      const existingMembership = await db.membership.findUnique({
        where: { id },
      })

      if (!existingMembership) {
        throw new NotFoundException('Membership item not found')
      }

      if (Array.isArray(membershipData.benefits)) {
        // If benefits is provided (even an empty array) treat it as an explicit replacement:
        // delete all existing and recreate only if the provided array has elements.
        await db.membershipBenefit.deleteMany({
          where: { membershipId: id },
        })

        if (membershipData.benefits.length > 0) {
          await db.membershipBenefit.createMany({
            data: membershipData.benefits.map((benefit) => ({
              membershipId: id,
              benefit: benefit,
            })),
            skipDuplicates: true,
          })
        }
      }

      const updatedMembership = await db.membership.update({
        where: { id },
        data: {
          name: membershipData.name,
          description: membershipData.description,
          price: membershipData.price,
          content: membershipData.content,
          contentHtml: membershipData.contentHtml,
          sport: membershipData.sport,
          type: membershipData.type,
          sessions: membershipData.sessions,
          duration: membershipData.duration,
          sequence: membershipData.sequence,
          isActive:
            membershipData.isActive !== undefined
              ? Boolean(membershipData.isActive)
              : undefined,
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

const adminMembershipCheckoutSchema = z
  .object({
    userId: z.string().optional(),
    name: z.string().min(1).optional(),
    phone: z.string().min(5).optional(),
    membershipId: z.string(),
    startDate: z
      .string()
      .refine((val) => dayjs(val).isValid(), {
        message: 'Invalid datetime format for startDate',
      })
      .optional(),
  })
  .refine((data) => !!data.userId || (!!data.name && !!data.phone), {
    message: 'Provide either userId or both name and phone for a new customer',
    path: ['userId'],
  })

type AdminMembershipCheckoutSchema = z.infer<
  typeof adminMembershipCheckoutSchema
>

export const adminMembershipCheckoutHandler = factory.createHandlers(
  zValidator('json', adminMembershipCheckoutSchema, validateHook),
  async (c) => {
    try {
      const admin = c.get('admin')
      const {
        userId: inputUserId,
        name,
        phone,
        membershipId,
        startDate,
      } = c.req.valid('json') as AdminMembershipCheckoutSchema

      const membership = await db.membership.findUnique({
        where: { id: membershipId },
      })

      if (!membership) {
        throw new NotFoundException('Membership not found')
      }

      if (!membership.isActive) {
        throw new BadRequestException('Membership is not active')
      }

      let resolvedUserId = inputUserId ?? null

      if (!resolvedUserId) {
        const formattedPhone = await formatPhone(phone!)
        const existingUser = await db.user.findUnique({
          where: { phone: formattedPhone },
          select: { id: true },
        })

        if (existingUser) {
          resolvedUserId = existingUser.id
        } else {
          const hashedPassword = await hashPassword(formattedPhone)
          const createdUser = await db.user.create({
            data: {
              name: name!,
              phone: formattedPhone,
              password: hashedPassword,
            },
            select: { id: true },
          })
          resolvedUserId = createdUser.id
        }
      } else {
        const user = await db.user.findUnique({
          where: { id: resolvedUserId },
          select: { id: true },
        })

        if (!user) {
          throw new NotFoundException('User not found')
        }
      }

      const result = await db.$transaction(async (tx) => {
        const membershipStart = startDate ? dayjs(startDate) : dayjs()
        const membershipEnd = membershipStart.add(membership.duration, 'days')

        const membershipUser = await tx.membershipUser.create({
          data: {
            userId: resolvedUserId!,
            membershipId: membership.id,
            startDate: membershipStart.toDate(),
            endDate: membershipEnd.toDate(),
            remainingSessions: membership.sessions,
            remainingDuration: membership.duration,
            isExpired: false,
            isSuspended: false,
          },
        })

        const invoiceNumber = await generateInvoiceNumber()

        const invoice = await tx.invoice.create({
          data: {
            userId: resolvedUserId!,
            membershipUserId: membershipUser.id,
            number: invoiceNumber,
            subtotal: membership.price,
            processingFee: 0,
            total: membership.price,
            status: PaymentStatus.PAID,
            issuedAt: new Date(),
            dueDate: dayjs().add(5, 'minutes').toDate(),
            paidAt: new Date(),
          },
        })

        return { membershipUser, invoice }
      })

      c.var.logger.info(
        `Admin ${admin?.id || 'unknown'} completed membership checkout for user ${result.membershipUser.userId}`,
      )

      return c.json(
        ok(
          {
            membershipUserId: result.membershipUser.id,
            invoiceId: result.invoice.id,
            invoiceNumber: result.invoice.number,
            total: result.invoice.total,
            startDate: result.membershipUser.startDate,
            endDate: result.membershipUser.endDate,
          },
          'Admin membership checkout successful',
        ),
        status.CREATED,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in adminMembershipCheckoutHandler: ${error}`)
      throw error
    }
  },
)
