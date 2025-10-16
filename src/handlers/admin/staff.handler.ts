import { ADMIN_PROFILE_SUBDIR } from '@/config'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { hashPassword } from '@/lib/password'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import { formatPhone } from '@/lib/utils'
import {
  createStaffSchema,
  CreateStaffSchema,
  IdSchema,
  idSchema,
  SearchQuerySchema,
  searchQuerySchema,
  updateStaffSchema,
} from '@/lib/validation'
import { deleteFile, getFileUrl, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'

export const getAllStaffHandler = factory.createHandlers(
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: ['name', 'email', 'phone'],
      })

      const staffId = c.var.admin?.id

      const items = await db.staff.findMany({
        ...queryOptions,
        where: {
          ...queryOptions.where,
          id: { not: staffId }, // Exclude the currently logged-in admin
        },
        include: {
          _count: {
            select: {
              slot: {
                where: {
                  OR: [
                    {
                      type: 'COACH',
                    },
                    {
                      type: 'BALLBOY',
                    },
                  ],
                },
              },
            },
          },
        },
      })

      for (const item of items) {
        if (item.image) {
          const imageUrl = await getFileUrl(item.image)
          item.image = imageUrl
        }
      }

      return c.json(ok(items), status.OK)
    } catch (err) {
      c.var.logger.fatal(`Error fetching staff list: ${err}`)
      throw err
    }
  },
)

export const getStaffHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('param') as IdSchema
      const staffId = validated.id

      const staff = await db.staff.findUnique({
        where: { id: staffId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          image: true,
          createdAt: true,
          role: true,
          isActive: true,
          joinedAt: true,
          slot: {
            select: {
              id: true,
              type: true,
              isAvailable: true,
              price: true,
              startAt: true,
              endAt: true,
            },
          },
        },
      })

      if (!staff) {
        throw new NotFoundException('Staff not found')
      }

      if (staff.image) {
        const imageUrl = await getFileUrl(staff.image)
        staff.image = imageUrl
      }

      return c.json(ok(staff), status.OK)
    } catch (err) {
      c.var.logger.fatal(`Error fetching staff details: ${err}`)
      throw err
    }
  },
)

export const createStaffHandler = factory.createHandlers(
  zValidator('form', createStaffSchema, validateHook),
  async (c) => {
    try {
      const validated = c.req.valid('form') as CreateStaffSchema
      const { name, email, phone, role, image, isActive, joinedAt } = validated

      const existingStaff = await db.staff.findFirst({
        where: {
          OR: [{ email }, { phone }],
        },
      })

      if (existingStaff) {
        throw new Error('Staff with the same email or phone already exists')
      }

      const formatedPhone = await formatPhone(phone)

      let imageUrl: string | undefined = undefined

      if (image) {
        const uploadedUrl = await uploadFile(image, {
          subdir: ADMIN_PROFILE_SUBDIR,
        })

        imageUrl = uploadedUrl.relativePath
      }

      const hashedPassword = await hashPassword(validated.password)

      const newStaff = await db.staff.create({
        data: {
          name,
          email,
          phone: formatedPhone,
          password: hashedPassword,
          role,
          image: imageUrl,
          isActive,
          joinedAt: joinedAt ? new Date(joinedAt) : new Date(),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          image: true,
          createdAt: true,
          role: true,
          isActive: true,
          joinedAt: true,
        },
      })

      if (newStaff.image) {
        const imageUrl = await getFileUrl(newStaff.image)
        newStaff.image = imageUrl
      }

      return c.json(ok(newStaff, 'Staff created successfully'), status.CREATED)
    } catch (err) {
      c.var.logger.fatal(`Error creating staff: ${err}`)
      throw err
    }
  },
)

export const updateStaffHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('form', updateStaffSchema, validateHook),
  async (c) => {
    try {
      const validatedParam = c.req.valid('param') as IdSchema
      const staffId = validatedParam.id
      const validatedForm = c.req.valid('form') as Partial<CreateStaffSchema>

      const existingStaff = await db.staff.findUnique({
        where: { id: staffId },
      })

      if (!existingStaff) {
        throw new NotFoundException('Staff not found')
      }

      if (validatedForm.email && validatedForm.email !== existingStaff.email) {
        const emailExists = await db.staff.findUnique({
          where: { email: validatedForm.email },
        })
        if (emailExists) {
          throw new Error('Email is already in use by another staff member')
        }
      }

      let phone = existingStaff.phone

      if (validatedForm.phone) {
        const formatedPhone = await formatPhone(validatedForm.phone)

        if (formatedPhone !== existingStaff.phone) {
          const phoneExists = await db.staff.findUnique({
            where: { phone: formatedPhone },
          })
          if (phoneExists) {
            throw new BadRequestException('Phone number is already in use')
          }

          phone = formatedPhone
        }
      }

      let imageUrl: string | null = existingStaff.image

      if (validatedForm.image) {
        if (existingStaff.image) {
          await deleteFile(existingStaff.image)
        }

        const uploadedUrl = await uploadFile(validatedForm.image, {
          subdir: ADMIN_PROFILE_SUBDIR,
        })
        imageUrl = uploadedUrl.relativePath
      }

      const updatedStaff = await db.staff.update({
        where: { id: staffId },
        data: {
          name: validatedForm.name,
          email: validatedForm.email,
          phone,
          role: validatedForm.role,
          image: imageUrl,
          isActive: validatedForm.isActive,
          joinedAt: validatedForm.joinedAt
            ? new Date(validatedForm.joinedAt)
            : new Date(),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          image: true,
          createdAt: true,
          role: true,
          isActive: true,
          joinedAt: true,
        },
      })

      if (updatedStaff.image) {
        const imageUrl = await getFileUrl(updatedStaff.image)
        updatedStaff.image = imageUrl
      }

      return c.json(ok(updatedStaff, 'Staff updated successfully'), status.OK)
    } catch (err) {
      c.var.logger.fatal(`Error updating staff: ${err}`)
      throw err
    }
  },
)

export const changeStaffPasswordHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const validatedParam = c.req.valid('param') as IdSchema
      const staffId = validatedParam.id

      const existingStaff = await db.staff.findUnique({
        where: { id: staffId },
      })

      if (!existingStaff) {
        throw new NotFoundException('Staff not found')
      }

      const defaultPassword = 'password'

      const hashedNewPassword = await hashPassword(defaultPassword)

      await db.staff.update({
        where: { id: staffId },
        data: { password: hashedNewPassword },
      })

      return c.json(
        ok(
          {
            generatedPassword: defaultPassword,
          },
          'Password changed successfully',
        ),
        status.OK,
      )
    } catch (err) {
      c.var.logger.fatal(`Error changing staff password: ${err}`)
      throw err
    }
  },
)

export const revokeStaffTokenHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const validatedParam = c.req.valid('param') as IdSchema
      const staffId = validatedParam.id

      const existingStaff = await db.staff.findUnique({
        where: { id: staffId },
      })

      if (!existingStaff) {
        throw new NotFoundException('Staff not found')
      }

      await db.authToken.deleteMany({
        where: { staffId },
      })

      return c.json(ok(null, 'Staff tokens revoked successfully'), status.OK)
    } catch (err) {
      c.var.logger.fatal(`Error revoking staff tokens: ${err}`)
      throw err
    }
  },
)
