import { CLUB_SUBDIR } from '@/config'
import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { err, ok } from '@/lib/response'
import {
  createClubSchema,
  CreateClubSchema,
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
  updateClubSchema,
} from '@/lib/validation'
import { deleteFile, getFileUrl, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

export const getAllClubHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name'],
      })

      const clubs = await db.club.findMany({
        ...queryOptions,
      })

      for (const club of clubs) {
        if (club.logo) {
          const logoUrl = await getFileUrl(club.logo)
          club.logo = logoUrl
        }
      }

      return c.json(ok(clubs), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getClubItemsHandler: ${error}`)
      throw error
    }
  },
)

export const getClubHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const club = await db.club.findUnique({
        where: { id },
      })

      if (!club) {
        throw new NotFoundException('Club not found')
      }

      if (club.logo) {
        const logoUrl = await getFileUrl(club.logo)
        club.logo = logoUrl
      }

      return c.json(ok(club), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getClubHandler: ${error}`)
      throw error
    }
  },
)

export const createClubHandler = factory.createHandlers(
  zValidator('form', createClubSchema, validateHook),
  async (c) => {
    try {
      const clubData = c.req.valid('form') as CreateClubSchema

      const clubNameExists = await db.club.findFirst({
        where: { name: clubData.name },
      })

      if (clubNameExists) {
        return c.json(
          err('Club name already exists'),
          status.BAD_REQUEST,
        )
      }
      
      let imageUrl: string | undefined
      if (clubData.logo) {
        const uploadResult = await uploadFile(clubData.logo, {
            subdir: CLUB_SUBDIR,
        })
        imageUrl = uploadResult.relativePath
      }

      const newClub = await db.club.create({
        data: {
          name: clubData.name,
          logo: imageUrl,
          description: clubData.description,
          rules: clubData.rules,
          leaderId: clubData.leaderId,
          visibility: clubData.visibility,
        },
      })

      return c.json(ok(newClub), status.CREATED)
    } catch (error) {
      c.var.logger.fatal(`Error in createClubHandler: ${error}`)
      throw error
    }
  },
)

export const updateClubHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updateClubSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const clubData = c.req.valid('form') as Partial<CreateClubSchema>

      const existingClub = await db.club.findUnique({
        where: { id },
      })

      if (!existingClub) {
        throw new NotFoundException('Club not found')
      }

      // Check for name uniqueness if name is being updated
      if (clubData.name && clubData.name !== existingClub.name) {
        const clubNameExists = await db.club.findFirst({
          where: { name: clubData.name },
        })

        if (clubNameExists) {
          return c.json(
            err('Club name already exists'),
            status.BAD_REQUEST,
          )
        }
      }

      const user = c.get('user')

      const isLeader = existingClub.leaderId === user?.id

      if (!isLeader) {
        return c.json(
          err('Only the club leader can update the club'),
          status.FORBIDDEN,
        )
      }

      let imageUrl: string | null = existingClub.logo
      if (clubData.logo) {
        if (existingClub.logo) {
          await deleteFile(existingClub.logo)
        }

        const uploadResult = await uploadFile(clubData.logo, {
            subdir: CLUB_SUBDIR,
        })
        imageUrl = uploadResult.relativePath
      }

      const updatedClub = await db.club.update({
        where: { id },
        data: {
            name: clubData.name,
            description: clubData.description,
            logo: imageUrl,
            rules: clubData.rules,
            leaderId: clubData.leaderId,
            visibility: clubData.visibility,
            isActive: clubData.isActive,
        },
      })

      return c.json(ok(updatedClub), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in updateClubHandler: ${error}`)
      throw error
    }
  },
)

export const deleteClubHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const existingClub = await db.club.findUnique({
        where: { id },
      })

      if (!existingClub) {
        throw new NotFoundException('Club not found')
      }

      const user = c.get('user')

      const isLeader = existingClub.leaderId === user?.id

      if (!isLeader) {
        return c.json(
          err('Only the club leader can delete the club'),
          status.FORBIDDEN,
        )
      }

      if (existingClub.logo) {
        await deleteFile(existingClub.logo)
      }

      await db.club.delete({
        where: { id },
      })

      return c.json(ok(null, 'Club deleted successfully'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in deleteClubHandler: ${error}`)
      throw error
    }
  },
)