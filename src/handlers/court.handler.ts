import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { getFileUrl } from '@/services/upload.service'

export const getAllCourtHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'description'],
      })

      const courts = await db.court.findMany({
        ...queryOptions,
        where: { isActive: true },
      })

      for (const court of courts) {
        if (court.image) {
          const imageUrl = await getFileUrl(court.image)
          court.image = imageUrl
        }
      }

      return c.json(ok(courts), status.OK)
    } catch (error) {
      console.error('Error fetching courts:', error)
      return c.json({ error: 'Failed to fetch courts' }, status.INTERNAL_SERVER_ERROR)
    }
  },
)

export const getCourtHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const court = await db.court.findUnique({
        where: { id, isActive: true },
      })

      if (!court) {
        throw new NotFoundException('Court not found')
      }

      if (court.image) {
        const imageUrl = await getFileUrl(court.image)
        court.image = imageUrl
      }

      return c.json(ok(court), status.OK)
    } catch (error) {
      console.error('Error fetching court:', error)
      return c.json({ error: 'Failed to fetch court' }, status.INTERNAL_SERVER_ERROR)
    }
  },
)