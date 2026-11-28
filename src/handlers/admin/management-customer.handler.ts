import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok } from '@/lib/response'
import { idSchema } from '@/lib/validation'
import { validateHook } from '@/helpers/validate-hook'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { formatPhone } from '@/lib/utils'
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return (
      Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value
    )
  }, 'Tanggal tidak valid.')
  .nullable()
  .optional()
const price = z.number().int().min(0).max(2147483647).optional()
export const managementCustomerSchema = z
  .object({
    isManagement: z.boolean(),
    managementCourtHourlyPrice: price,
    managementCoachHourlyPrice: price,
    managementExtraParticipantHourlyPrice: price,
    managementPadelHappyHourlyPrice: price,
    managementPadelPeakHourlyPrice: price,
    managementTennisHappyHourlyPrice: price,
    managementTennisPeakHourlyPrice: price,
    managementValidFrom: date,
    managementValidUntil: date,
  })
  .strict()
  .refine(
    (value) =>
      value.isManagement ||
      !(
        value.managementCourtHourlyPrice ||
        value.managementCoachHourlyPrice ||
        value.managementExtraParticipantHourlyPrice ||
        value.managementPadelHappyHourlyPrice ||
        value.managementPadelPeakHourlyPrice ||
        value.managementTennisHappyHourlyPrice ||
        value.managementTennisPeakHourlyPrice
      ),
    'Tarif khusus hanya untuk pelanggan Management.',
  )
const createSchema = z
  .object({
    name: z.string().trim().min(3).max(100),
    phone: z.string().trim().min(10).max(20),
    managementValidFrom: date,
    managementValidUntil: date,
  })
  .strict()
const fields = (
  input: {
    isManagement?: boolean
    managementValidFrom?: string | null
    managementValidUntil?: string | null
    managementCourtHourlyPrice?: number
    managementCoachHourlyPrice?: number
    managementExtraParticipantHourlyPrice?: number
    managementPadelHappyHourlyPrice?: number
    managementPadelPeakHourlyPrice?: number
    managementTennisHappyHourlyPrice?: number
    managementTennisPeakHourlyPrice?: number
  },
  actor: string,
) => ({
  isManagement: input.isManagement ?? true,
  managementValidFrom: input.managementValidFrom
    ? new Date(`${input.managementValidFrom}T00:00:00Z`)
    : null,
  managementValidUntil: null,
  managementCourtHourlyPrice:
    input.isManagement === false ? 0 : input.managementCourtHourlyPrice,
  managementCoachHourlyPrice:
    input.isManagement === false ? 0 : input.managementCoachHourlyPrice,
  managementExtraParticipantHourlyPrice:
    input.isManagement === false
      ? 0
      : input.managementExtraParticipantHourlyPrice,
  managementPadelHappyHourlyPrice:
    input.isManagement === false ? 0 : input.managementPadelHappyHourlyPrice,
  managementPadelPeakHourlyPrice:
    input.isManagement === false ? 0 : input.managementPadelPeakHourlyPrice,
  managementTennisHappyHourlyPrice:
    input.isManagement === false ? 0 : input.managementTennisHappyHourlyPrice,
  managementTennisPeakHourlyPrice:
    input.isManagement === false ? 0 : input.managementTennisPeakHourlyPrice,
  managementAssignedBy: actor,
})
export const createManagementCustomerHandler = factory.createHandlers(
  zValidator('json', createSchema, validateHook),
  async (c) => {
    const input = c.req.valid('json')
    const phone = await formatPhone(input.phone)
    if (!/^\+62\d{8,13}$/.test(phone))
      throw new BadRequestException('Nomor WhatsApp tidak valid.')
    if (await db.user.findUnique({ where: { phone } }))
      throw new BadRequestException(
        'Nomor sudah terdaftar. Buka detail pelanggan untuk mengaktifkan kategori Management.',
      )
    const user = await db.user.create({
      data: {
        name: input.name,
        phone,
        source: 'ADMIN_CREATED',
        ...fields(input, c.get('admin')!.id),
      },
    })
    return c.json(
      ok({ id: user.id }, 'Pelanggan Management berhasil dibuat.'),
      201,
    )
  },
)
export const updateManagementCustomerHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', managementCustomerSchema, validateHook),
  async (c) => {
    const { id } = c.req.valid('param')
    if (!(await db.user.findUnique({ where: { id }, select: { id: true } })))
      throw new NotFoundException('Pelanggan tidak ditemukan.')
    await db.user.update({
      where: { id },
      data: fields(c.req.valid('json'), c.get('admin')!.id),
    })
    return c.json(ok({ id }, 'Kategori Management berhasil diperbarui.'))
  },
)
