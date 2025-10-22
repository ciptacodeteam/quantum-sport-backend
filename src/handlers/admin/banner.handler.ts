import { BANNER_SUBDIR } from '@/config'
import { NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  createBannerSchema,
  CreateBannerSchema,
  idSchema,
  IdSchema,
  searchQuerySchema,
  SearchQuerySchema,
  updateBannerSchema,
} from '@/lib/validation'
import { deleteFile, getFileUrl, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

export const getAllBannerHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
      })

      const banners = await db.banner.findMany({
        ...queryOptions,
        orderBy: { sequence: 'asc' },
      })

      for (const banner of banners) {
        if (banner.image) {
          const imageUrl = await getFileUrl(banner.image)
          banner.image = imageUrl
        }
      }

      return c.json(ok(banners), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getBannerItemsHandler: ${error}`)
      throw error
    }
  },
)

export const getBannerHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const banner = await db.banner.findUnique({
        where: { id },
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
      c.var.logger.fatal(`Error in getBannerHandler: ${error}`)
      throw error
    }
  },
)

export const createBannerHandler = factory.createHandlers(
  zValidator('form', createBannerSchema, validateHook),
  async (c) => {
    try {
      const bannerData = c.req.valid('form') as CreateBannerSchema

      let imageUrl: string = ""
      if (bannerData.image) {
        const uploadResult = await uploadFile(bannerData.image, { 
            subdir: BANNER_SUBDIR 
        })
        imageUrl = uploadResult.relativePath
      }

      const newBanner = await db.banner.create({
        data: {
            image: imageUrl,
            link: bannerData.link,
            startAt: bannerData.startAt ? new Date(bannerData.startAt) : null,
            endAt: bannerData.endAt ? new Date(bannerData.endAt) : null,
        },
      })

      return c.json(ok(newBanner), status.CREATED)
    } catch (error) {
      c.var.logger.fatal(`Error in createBannerHandler: ${error}`)
      throw error
    }
  },
)

export const updateBannerHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updateBannerSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const bannerData = c.req.valid('form') as Partial<CreateBannerSchema>

      const existingBanner = await db.banner.findUnique({
        where: { id },
      })

      if (!existingBanner) {
        throw new NotFoundException('Banner not found')
      }

      let imageUrl: string = existingBanner.image
      if (bannerData.image) {
        if (existingBanner.image) {
          await deleteFile(existingBanner.image)
        }

        const uploadResult = await uploadFile(bannerData.image, { 
            subdir: BANNER_SUBDIR 
        })
        imageUrl = uploadResult.relativePath
      }

      const updatedBanner = await db.banner.update({
        where: { id },
        data: {
            image: imageUrl,
            link: bannerData.link,
            startAt: bannerData.startAt ? new Date(bannerData.startAt) : existingBanner.startAt,
            endAt: bannerData.endAt ? new Date(bannerData.endAt) : existingBanner.endAt,
            sequence: bannerData.sequence,
        },
      })

      return c.json(ok(updatedBanner), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in updateBannerHandler: ${error}`)
      throw error
    }
  },
)

export const deleteBannerHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
        const { id } = c.req.valid('param') as IdSchema
        
        const existingBanner = await db.banner.findUnique({
            where: { id },
        })

        if (!existingBanner) {
            throw new NotFoundException('Banner not found')
        }

        if (existingBanner.image) {
            await deleteFile(existingBanner.image)
        }

        await db.banner.delete({
            where: { id },
        })

        return c.json(ok(null, 'Banner deleted successfully'), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in deleteBannerHandler: ${error}`)
      throw error
    }
  },
)