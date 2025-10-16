import { COURT_SUBDIR } from '@/config'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import {
  CreateCourtSchema,
  createCourtSchema,
  IdSchema,
  idSchema,
  searchQuerySchema,
  SearchQuerySchema,
  UpdateCourtSchema,
  updateCourtSchema,
} from '@/lib/validation'
import { deleteFile, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import { ok } from 'assert'
import status from 'http-status'

export const getAllCourtHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'description'],
      })

      const items = await db.court.findMany({
        ...queryOptions,
      })
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

      return c.json(ok(item), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getCourtHandler: ${error}`)
      throw error
    }
  },
)

export const createCourtHandler = factory.createHandlers(
  zValidator('json', createCourtSchema, validateHook),
  async (c) => {
    try {
      const body = c.req.valid('json') as CreateCourtSchema
      const { name, description, image } = body

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
          isActive: false,
        },
      })

      return c.json(ok(newItem), status.CREATED)
    } catch (error) {
      c.var.logger.fatal(`Error in createCourt: ${error}`)
      throw error
    }
  },
)

export const updateCourtHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', updateCourtSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const body = c.req.valid('json') as UpdateCourtSchema
      const { name, description, image, isActive } = body

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

        const uploaded = await uploadFile(image)
        imageUrl = uploaded.relativePath
      }

      const updatedItem = await db.court.update({
        where: { id },
        data: {
          name: name ?? existingItem.name,
          description: description ?? existingItem.description,
          image: imageUrl,
          isActive: isActive ?? false,
        },
      })

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
        where: { courtId: id },
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
