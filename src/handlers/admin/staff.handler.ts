import { ADMIN_PROFILE_SUBDIR } from '@/config'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { getScheduleFromDateRange } from '@/lib/day'
import { hashPassword } from '@/lib/password'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import { formatPhone } from '@/lib/utils'
import {
  CreateBallboyScheduleSchema,
  createBallboyScheduleSchema,
  createStaffSchema,
  CreateStaffSchema,
  IdSchema,
  idSchema,
  SearchQuerySchema,
  searchQuerySchema,
  updateStaffSchema,
} from '@/lib/validation'
import { deleteFile, getFilePath, uploadFile } from '@/services/upload.service'
import { zValidator } from '@hono/zod-validator'
import dayjs from 'dayjs'
import { Prisma, Role } from 'generated/prisma'
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
      })

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
          ballboySchedule: {
            select: {
              id: true,
              date: true,
              isAvailable: true,
              time: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          coachSchedule: {
            select: {
              id: true,
              date: true,
              time: true,
              isAvailable: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      })

      if (!staff) {
        throw new NotFoundException('Staff not found')
      }

      if (staff.image) {
        const imageUrl = await getFilePath(staff.image)
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
          joinedAt: dayjs(joinedAt).toDate(),
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
        const imageUrl = await getFilePath(newStaff.image)
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
            ? dayjs(validatedForm.joinedAt).toDate()
            : undefined,
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
        const imageUrl = await getFilePath(updatedStaff.image)
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

export const createBallboyScheduleHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', createBallboyScheduleSchema, validateHook),
  async (c) => {
    try {
      const validatedParam = c.req.valid('param') as IdSchema
      const staffId = validatedParam.id
      const validatedForm = c.req.valid('json') as CreateBallboyScheduleSchema

      const { type, single, range } = validatedForm

      const existingStaff = await db.staff.findUnique({
        where: { id: staffId },
      })

      if (!existingStaff) {
        throw new NotFoundException('Staff not found')
      }

      if (existingStaff.role !== Role.BALLBOY) {
        throw new BadRequestException('Staff is not a ballboy')
      }

      if (type === 'single') {
        if (!single) {
          throw new BadRequestException('Single schedule data is required')
        }

        const { date, time, isAvailable } = single

        const existingSchedule = await db.ballboySchedule.findFirst({
          where: {
            staffId,
            date: dayjs(date).toDate(),
            time,
          },
        })

        if (existingSchedule) {
          throw new BadRequestException(
            'Schedule already exists for the given date and time',
          )
        }

        const newSchedule = await db.ballboySchedule.create({
          data: {
            staffId,
            date: dayjs(date).toDate(),
            time,
            isAvailable,
          },
          select: {
            id: true,
            date: true,
            time: true,
            isAvailable: true,
            createdAt: true,
            updatedAt: true,
          },
        })

        return c.json(
          ok(newSchedule, 'Ballboy schedule created successfully'),
          status.CREATED,
        )
      } else if (type === 'range') {
        if (!range) {
          throw new BadRequestException('Range schedule data is required')
        }

        const { fromDate, toDate, fromTime, toTime, days } = range

        const schedulesToCreate: Array<Prisma.BallboyScheduleCreateManyInput> =
          []

        const generatedSchedules = getScheduleFromDateRange(
          fromDate,
          toDate,
          fromTime,
          toTime,
          days,
        )

        c.var.logger.debug(
          `Generated ${generatedSchedules.length} schedules from range`,
        )

        if (generatedSchedules.length === 0) {
          throw new BadRequestException('No schedules generated from the range')
        }

        c.var.logger.debug(
          `Generated Schedules: ${JSON.stringify(generatedSchedules)}`,
        )

        const existingSchedules = await db.ballboySchedule.findMany({
          where: {
            staffId,
            date: {
              gte: dayjs(fromDate).toDate(),
              lte: dayjs(toDate).toDate(),
            },
          },
        })

        if (existingSchedules.length > 0) {
          c.var.logger.debug(
            `Found ${existingSchedules.length} existing schedules in the range`,
          )
        }

        const existingScheduleSet = new Set(
          existingSchedules.map(
            (s) => `${dayjs(s.date).format('YYYY-MM-DD')}-${s.time}`,
          ),
        )

        for (const sched of generatedSchedules) {
          const key = `${sched.date}-${sched.time}`
          if (!existingScheduleSet.has(key)) {
            schedulesToCreate.push({
              staffId,
              date: dayjs(sched.date, 'YYYY-MM-DD', true)
                .add(1, 'day')
                .toDate(),
              time: sched.time,
              isAvailable: true,
            })
          }
        }

        if (schedulesToCreate.length === 0) {
          throw new BadRequestException(
            'No new schedules to create in the given range',
          )
        }

        c.var.logger.debug(
          `Creating ${schedulesToCreate.length} schedules for ballboy ID ${staffId}`,
        )
        c.var.logger.debug(`Schedules: ${JSON.stringify(schedulesToCreate)}`)

        const createdSchedules = await db.ballboySchedule.createMany({
          data: schedulesToCreate,
        })

        c.var.logger.debug(
          `Created ${createdSchedules.count} schedules for ballboy ID ${staffId}`,
        )

        c.var.logger.debug(
          `Created Schedules: ${JSON.stringify(createdSchedules)}`,
        )

        return c.json(
          ok(createdSchedules, 'Ballboy schedules created successfully'),
          status.CREATED,
        )
      } else {
        throw new BadRequestException('Invalid schedule type')
      }
    } catch (err) {
      c.var.logger.fatal(`Error creating ballboy schedule: ${err}`)
      throw err
    }
  },
)
