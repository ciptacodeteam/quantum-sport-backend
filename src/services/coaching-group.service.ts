import { z } from 'zod'
import type { Prisma, CourtSport } from '@prisma/client'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { db } from '@/lib/prisma'
import { uploadFile, deleteFile } from './upload.service'

export const coachingGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2000).default(''),
    logo: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).default(''),
    sports: z
      .array(z.enum(['PADEL', 'TENNIS']))
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length),
    branchIds: z
      .array(z.string().min(1))
      .min(1)
      .max(100)
      .refine((v) => new Set(v).size === v.length),
    isActive: z.boolean(),
  })
  .strict()

export const coachingGroupUploadSchema = z
  .object({
    data: z
      .string()
      .transform((value, ctx) => {
        try {
          return JSON.parse(value)
        } catch {
          ctx.addIssue({ code: 'custom', message: 'Data grup tidak valid.' })
          return z.NEVER
        }
      })
      .pipe(coachingGroupSchema),
    logo: z
      .file()
      .min(1)
      .max(5 * 1024 * 1024)
      .mime(['image/jpeg', 'image/png', 'image/webp'])
      .optional(),
    removeLogo: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .strict()
  .refine((v) => !(v.logo && v.removeLogo), 'Pilih unggah atau hapus logo.')

export async function saveCoachingGroupUpload(
  id: string | undefined,
  input: z.infer<typeof coachingGroupUploadSchema>,
) {
  let uploaded: Awaited<ReturnType<typeof uploadFile>> | undefined
  try {
    if (input.logo)
      uploaded = await uploadFile(input.logo, { subdir: 'coaching-groups' })
    return await saveCoachingGroup(id, input.data, {
      uploadedLogo: uploaded?.absolutePath,
      removeLogo: input.removeLogo,
    })
  } catch (error) {
    // Only remove the new asset owned by this failed request. Existing URLs may be shared.
    if (uploaded) await deleteFile(uploaded.absolutePath).catch(() => false)
    throw error
  }
}

export const coachingGroupMembershipSelect = {
  group: {
    select: {
      id: true,
      name: true,
      isActive: true,
      sports: true,
      branches: { select: { branchId: true } },
    },
  },
} satisfies Prisma.CoachingGroupCoachSelect

type Membership = {
  group: {
    id: string
    name: string
    isActive: boolean
    sports: CourtSport[]
    branches: { branchId: string }[]
  }
}
export function eligibleCoachingGroups(
  memberships: Membership[] | undefined,
  branchId: string,
  sports: CourtSport[],
) {
  return (memberships ?? [])
    .map((m) => m.group)
    .filter(
      (g) =>
        g.isActive &&
        sports.every((s) => g.sports.includes(s)) &&
        g.branches.some((b) => b.branchId === branchId),
    )
    .map((g) => ({ id: g.id, name: g.name }))
}
export async function validateCoachGroups(
  client: Pick<Prisma.TransactionClient, 'coachingGroup'>,
  ids: string[] | undefined,
  branchId: string,
  kind: string,
  coachType?: string | null,
) {
  if (!ids?.length) return
  if (kind !== 'COACH')
    throw new BadRequestException('Grup coaching hanya untuk coach.')
  const groups = await client.coachingGroup.findMany({
    where: {
      id: { in: ids },
      isActive: true,
      branches: { some: { branchId } },
    },
  })
  if (
    groups.length !== ids.length ||
    groups.some(
      (g) =>
        !g.sports.some((s) => coachType === s || coachType === 'PADEL_TENNIS'),
    )
  )
    throw new BadRequestException(
      'Grup harus aktif dan sesuai cabang serta olahraga coach.',
    )
}
export async function resolveBookingCoachingGroup(
  client: Prisma.TransactionClient,
  staff: { id: string; coachingGroups?: Membership[] },
  branchId: string,
  sports: CourtSport[],
  groupId?: string,
) {
  if (!groupId) {
    if (staff.coachingGroups?.length)
      throw new BadRequestException('Pilih grup coaching untuk coach ini.')
    return { coachingGroupId: null, coachingGroupName: null }
  }
  await client.$queryRaw`SELECT id FROM coaching_groups WHERE id = ${groupId} FOR SHARE`
  const group = await client.coachingGroup.findFirst({
    where: {
      id: groupId,
      isActive: true,
      sports: { hasEvery: sports },
      branches: { some: { branchId } },
      coaches: { some: { staffId: staff.id } },
    },
  })
  if (!group)
    throw new BadRequestException(
      'Coach tidak tersedia di grup, cabang, atau olahraga yang dipilih. Muat ulang pilihan.',
    )
  return { coachingGroupId: group.id, coachingGroupName: group.name }
}
export async function saveCoachingGroup(
  id: string | undefined,
  input: z.infer<typeof coachingGroupSchema>,
  logoChange?: { uploadedLogo?: string; removeLogo: boolean },
) {
  return db
    .$transaction(async (tx) => {
      let previousLogo: string | null = null
      if (id) {
        await tx.$queryRaw`SELECT id FROM coaching_groups WHERE id = ${id} FOR UPDATE`
        const existing = await tx.coachingGroup.findUnique({ where: { id } })
        if (!existing)
          throw new NotFoundException('Grup coaching tidak ditemukan.')
        previousLogo = existing.logo
      }
      if (
        (await tx.branch.count({
          where: { id: { in: input.branchIds }, isActive: true },
        })) !== input.branchIds.length
      )
        throw new BadRequestException('Pilih cabang aktif yang tersedia.')
      const { branchIds, logo, description, ...fields } = input
      const data = {
        ...fields,
        logo: logoChange
          ? logoChange.removeLogo
            ? null
            : (logoChange.uploadedLogo ?? previousLogo)
          : logo || null,
        description: description || null,
        branches: {
          ...(id ? { deleteMany: {} } : {}),
          create: branchIds.map((branchId) => ({ branchId })),
        },
      }
      return id
        ? tx.coachingGroup.update({ where: { id }, data })
        : tx.coachingGroup.create({ data })
    })
    .catch((error: unknown) => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new BadRequestException('Nama grup coaching sudah digunakan.')
      throw error
    })
}

/** Shared catalog deletion: preserve booking snapshots across every branch. */
export async function deleteCoachingGroup(id: string) {
  return db.$transaction(async (tx) => {
    // Booking selection takes a shared lock on this same row.
    await tx.$queryRaw`SELECT id FROM coaching_groups WHERE id = ${id} FOR UPDATE`
    const group = await tx.coachingGroup.findUnique({ where: { id } })
    if (!group) throw new NotFoundException('Grup coaching tidak ditemukan.')
    // Preserve legacy names as well. Existing snapshots must never be renamed.
    // This global-catalog operation deliberately includes all branches.
    await tx.$executeRaw`UPDATE booking_coaches SET "coachingGroupName" = ${group.name}
      WHERE "coachingGroupId" = ${id} AND ("coachingGroupName" IS NULL OR "coachingGroupName" = '')`
    // FK rules remove memberships and branches, and null only the booking's
    // group reference. Staff, bookings, and financial snapshots are retained.
    await tx.coachingGroup.delete({ where: { id } })
    return { id: group.id, name: group.name }
  })
}
