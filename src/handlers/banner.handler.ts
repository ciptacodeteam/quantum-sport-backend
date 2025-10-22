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

export const getAllBannerHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
      })

      const items = await db.banner.findMany({
        ...queryOptions,
        where: { isActive: true },
        orderBy: { sequence: 'asc' },
      })

      for (const item of items) {
        if (item.image) {
          const imageUrl = await getFileUrl(item.image)
          item.image = imageUrl
        }
      }

      return c.json(ok(items), status.OK)
    } catch (error) {
      console.error('Error fetching banners:', error)
      return c.json(
        { error: 'Failed to fetch banners' },
        status.INTERNAL_SERVER_ERROR,
      )
    }
  },
)

export const getBannerHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const paramValidated = c.req.valid('param') as IdSchema
      const bannerId = paramValidated.id

      const banner = await db.banner.findUnique({
        where: { id: bannerId },
      })

      if (!banner) {
        throw new NotFoundException('Banner not found')
      }

      if (banner.image) {
        const imageUrl = await getFileUrl(banner.image)
        banner.image = imageUrl
      }

      return c.json(ok(banner), status.OK)
    } catch (error) {
      console.error('Error fetching banner:', error)
      return c.json(
        { error: 'Failed to fetch banner' },
        status.INTERNAL_SERVER_ERROR,
      )
    }
  },
)