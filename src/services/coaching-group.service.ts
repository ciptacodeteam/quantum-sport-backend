import { z } from 'zod'
import type { Prisma, CourtSport } from '@prisma/client'
import { BadRequestException, NotFoundException } from '@/exceptions'
import { db } from '@/lib/prisma'

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
) {
  return db
    .$transaction(async (tx) => {
      if (id) {
        await tx.$queryRaw`SELECT id FROM coaching_groups WHERE id = ${id} FOR UPDATE`
        if (!(await tx.coachingGroup.findUnique({ where: { id } })))
          throw new NotFoundException('Grup coaching tidak ditemukan.')
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
        logo: logo || null,
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
