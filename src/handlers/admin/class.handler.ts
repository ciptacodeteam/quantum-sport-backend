import { CLASS_SUBDIR } from '@/config'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  createClassSchema,
  CreateClassSchema,
  IdSchema,
  idSchema,
  SearchQuerySchema,
  searchQuerySchema,
  UpdateClassSchema,
  updateClassSchema,
} from '@/lib/validation'
import { deleteFile, getFileUrl, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

export const getAllClassHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'description'],
      })

      const classes = await db.class.findMany({
        ...queryOptions,
      })

      for (const classItem of classes) {
        if (classItem.image) {
          const imageUrl = await getFileUrl(classItem.image)
          classItem.image = imageUrl
        }
      }

      return c.json(ok(classes), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getClassItemsHandler: ${error}`)
      throw error
    }
  },
)

export const getClassHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const classItem = await db.class.findUnique({
        where: { id },
      })

      if (!classItem) {
        throw new NotFoundException('Class not found')
      }

      if (classItem.image) {
        const imageUrl = await getFileUrl(classItem.image)
        classItem.image = imageUrl
      }

      return c.json(ok(classItem), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getClassHandler: ${error}`)
      throw error
    }
  },
)

export const createClassHandler = factory.createHandlers(
  zValidator('form', createClassSchema, validateHook),
  async (c) => {
    try {
      const classData = c.req.valid('form') as CreateClassSchema

      let imageUrl: string | undefined = undefined
      if (classData.image) {
        const uploadResult = await uploadFile(classData.image, {
            subdir: CLASS_SUBDIR,
        }) 
        imageUrl = await getFileUrl(uploadResult.relativePath)
      }

      const newClass = await db.class.create({
        data: {
          name: classData.name,
          description: classData.description,
          content: classData.content,
          organizerName: classData.organizerName,
          speakerName: classData.speakerName,
          image: imageUrl,
          startDate: new Date(classData.startDate),
          endDate: new Date(classData.endDate),
          startTime: classData.startTime,
          endTime: classData.endTime,
          price: classData.price,
          sessions: classData.sessions,
          capacity: classData.capacity,
          remaining: classData.remaining,
          maxBookingPax: classData.maxBookingPax,
          gender: classData.gender,
          ageMin: classData.ageMin,
        },
      })

      return c.json(ok(newClass), status.CREATED)
    } catch (error) {
      c.var.logger.fatal(`Error in createClassHandler: ${error}`)
      throw error
    }
  },
)

export const updateClassHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updateClassSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const classData = c.req.valid('form') as Partial<UpdateClassSchema>

      const existingClass = await db.class.findUnique({
        where: { id },
      })

      if (!existingClass) {
        throw new NotFoundException('Class not found')
      }

      let imageUrl: string | null = existingClass.image

      if (classData.image) {
        if (existingClass.image) {
          await deleteFile(existingClass.image)
        }
        const uploadResult = await uploadFile(classData.image, {
            subdir: CLASS_SUBDIR,
        }) 
        imageUrl = await getFileUrl(uploadResult.relativePath)
      }

      const updatedClass = await db.class.update({
        where: { id },
        data: {
          name: classData.name,
          description: classData.description,
          content: classData.content,
          organizerName: classData.organizerName,
          speakerName: classData.speakerName,
          image: imageUrl,
          startDate: classData.startDate
            ? new Date(classData.startDate)
            : existingClass.startDate,
          endDate: classData.endDate
            ? new Date(classData.endDate)
            : existingClass.endDate,
          startTime: classData.startTime ?? existingClass.startTime,
          endTime: classData.endTime ?? existingClass.endTime,
          price: classData.price ?? existingClass.price,
          sessions: classData.sessions ?? existingClass.sessions,
          capacity: classData.capacity ?? existingClass.capacity,
          remaining: classData.remaining ?? existingClass.remaining,
          maxBookingPax:
            classData.maxBookingPax ?? existingClass.maxBookingPax,
          gender: classData.gender ?? existingClass.gender,
          ageMin: classData.ageMin ?? existingClass.ageMin,
        },
      })

      return c.json(ok(updatedClass), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in updateClassHandler: ${error}`)
      throw error
    }
  },
)

export const deleteClassHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const existingClass = await db.class.findUnique({
        where: { id },
      })

      if (!existingClass) {
        throw new NotFoundException('Class not found')
      }

      if (existingClass.image) {
        await deleteFile(existingClass.image)
      }

      await db.class.delete({
        where: { id },
      })

      return c.json(ok(null, 'Class deleted successfully'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in deleteClassHandler: ${error}`)
      throw error
    }
  },
)