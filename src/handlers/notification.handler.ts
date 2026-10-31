import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { ok } from '@/lib/response'
import { idSchema } from '@/lib/validation'
import { requireAuth } from '@/middlewares/auth'
import { notificationService } from '@/services/notification.service'
import { zValidator } from '@hono/zod-validator'
import { NotificationAudience, NotificationType } from '@prisma/client'
import status from 'http-status'
import z from 'zod'

const paginationSchema = z.object({
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
})

const adminPushSchema = z.object({
  userId: z.string().optional(), // if omitted and audience=ALL broadcast
  audience: z.nativeEnum(NotificationAudience).default('USER'),
  title: z.string().min(1),
  message: z.string().optional(),
  type: z.nativeEnum(NotificationType).default('ADMIN_PUSH'),
  data: z.record(z.string(), z.any()).optional(),
})

export const getUserNotificationsHandler = factory.createHandlers(
  requireAuth,
  zValidator('query', paginationSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user?.id) {
        return c.json(ok([], 'Unauthorized'), status.UNAUTHORIZED)
      }
      const { cursor, take } = c.req.valid('query') as z.infer<
        typeof paginationSchema
      >
      const notifications = await notificationService.listForUser(
        user.id,
        take,
        cursor,
      )
      return c.json(ok(notifications), status.OK)
    } catch (error) {
      c.var.logger.error(`Error in getUserNotificationsHandler: ${error}`)
      throw error
    }
  },
)

export const markUserNotificationReadHandler = factory.createHandlers(
  requireAuth,
  async (c) => {
    try {
      const user = c.get('user')
      if (!user?.id) {
        return c.json(ok(null, 'Unauthorized'), status.UNAUTHORIZED)
      }
      const id = c.req.param('id')
      if (!id) {
        return c.json(ok(null, 'Notification id required'), status.BAD_REQUEST)
      }
      const updated = await notificationService.markRead(id, user.id)
      return c.json(ok(updated), status.OK)
    } catch (error) {
      c.var.logger.error(`Error in markUserNotificationReadHandler: ${error}`)
      throw error
    }
  },
)

// App-level requireAdminAuth already runs before branch context. Do not
// re-check Staff here — branch scope would hide SUPER_ADMIN on other cabang.
export const pushAdminNotificationHandler = factory.createHandlers(
  zValidator('json', adminPushSchema, validateHook),
  async (c) => {
    try {
      const body = c.req.valid('json') as z.infer<typeof adminPushSchema>
      const notif = await notificationService.create({
        userId: body.userId,
        audience: body.audience,
        type: body.type,
        title: body.title,
        message: body.message,
        data: body.data,
      })
      return c.json(ok(notif), status.CREATED)
    } catch (error) {
      c.var.logger.error(`Error in pushAdminNotificationHandler: ${error}`)
      throw error
    }
  },
)

export const getAdminNotificationsHandler = factory.createHandlers(
  zValidator('query', paginationSchema, validateHook),
  async (c) => {
    try {
      const admin = c.get('admin')
      if (!admin?.id) {
        return c.json(ok([], 'Unauthorized'), status.UNAUTHORIZED)
      }
      const { cursor, take } = c.req.valid('query') as z.infer<
        typeof paginationSchema
      >
      // Get notifications for this specific admin (userId = admin.id) or broadcast notifications
      const notifications = await notificationService.listForAdminUser(
        admin.id,
        take,
        cursor,
      )
      return c.json(ok(notifications), status.OK)
    } catch (error) {
      c.var.logger.error(`Error in getAdminNotificationsHandler: ${error}`)
      throw error
    }
  },
)

export const markAdminNotificationReadHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const admin = c.get('admin')
      if (!admin?.id) {
        return c.json(ok(null, 'Unauthorized'), status.UNAUTHORIZED)
      }
      const id = c.req.param('id')
      if (!id) {
        return c.json(ok(null, 'Notification id required'), status.BAD_REQUEST)
      }
      const updated = await notificationService.markRead(id, admin.id)
      return c.json(ok(updated), status.OK)
    } catch (error) {
      c.var.logger.error(`Error in markAdminNotificationReadHandler: ${error}`)
      throw error
    }
  },
)

export const markAllAdminNotificationsReadHandler = factory.createHandlers(
  async (c) => {
    try {
      const admin = c.get('admin')
      if (!admin?.id) {
        return c.json(ok(null, 'Unauthorized'), status.UNAUTHORIZED)
      }
      const updatedCount = await notificationService.markAllReadForAdmin(
        admin.id,
      )
      return c.json(
        ok({ updatedCount }, 'All notifications marked as read'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.error(
        `Error in markAllAdminNotificationsReadHandler: ${error}`,
      )
      throw error
    }
  },
)
