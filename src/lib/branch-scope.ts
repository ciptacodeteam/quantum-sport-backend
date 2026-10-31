import { Prisma } from '@prisma/client'
import { BadRequestException, ForbiddenException } from '@/exceptions'
import { branchContext, type BranchContext } from './branch-context'

type Args = Record<string, any>
const models = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [model.name, model]),
)
const direct = new Set(
  Prisma.dmmf.datamodel.models
    .filter(
      (model) =>
        model.fields.some((field) => field.name === 'branchId') &&
        model.name !== 'MembershipBranch',
    )
    .map((model) => model.name),
)
const parents: Record<string, string> = {
  BookingDetail: 'booking',
  BookingInventory: 'booking',
  BookingBallboy: 'booking',
  BookingCoach: 'booking',
  ClassBookingDetail: 'classBooking',
  CoachTypeStaffPrice: 'staff',
  Payment: 'invoice',
}
const globalCatalogs = new Set([
  'Membership',
  'MembershipBenefit',
  'MembershipBranch',
  'PaymentMethod',
  'BookingCoachType',
])
const writes = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
])
const delegate = (model: string) => model[0].toLowerCase() + model.slice(1)

export function branchWhere(
  model: string,
  context: Pick<
    BranchContext,
    'branchId' | 'isAdmin' | 'isSuperAdmin' | 'membershipMode'
  >,
): Args | null {
  const branchId = context.branchId
  if (!branchId) return null
  if (direct.has(model))
    return model === 'Staff' && context.isAdmin && !context.isSuperAdmin
      ? { branchId, role: { not: 'SUPER_ADMIN' } }
      : { branchId }
  if (parents[model]) return { [parents[model]]: { branchId } }
  // Products and customer quota are shared across playing locations. Only
  // financial sales reports retain the purchase invoice's branch attribution.
  if (model === 'Membership' || model === 'MembershipBenefit') return null
  if (model === 'MembershipUser')
    return context.membershipMode === 'sales' ? { invoice: { branchId } } : null
  if (model === 'MembershipBranch') return { branchId }
  if (model === 'AuthToken' && context.isAdmin) return { staff: { branchId } }
  return null
}
const andWhere = (where: Args | undefined, filter: Args) => ({
  ...where,
  AND: [
    filter,
    ...(where?.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
  ],
})

// Prisma query extensions do not automatically scope nested includes. Scope every list and count.
export function scopeRelations(
  model: string,
  args: Args,
  context: BranchContext,
): void {
  const fields = models.get(model)?.fields ?? []
  for (const selection of [args.select, args.include]) {
    if (!selection || typeof selection !== 'object') continue
    for (const [key, value] of Object.entries(selection)) {
      if (!value) continue
      if (key === '_count') {
        const count =
          value === true
            ? {
                select: Object.fromEntries(
                  fields
                    .filter((f) => f.kind === 'object' && f.isList)
                    .map((f) => [f.name, true]),
                ),
              }
            : (value as Args)
        if (!count.select) continue
        for (const [name, enabled] of Object.entries(count.select)) {
          const field = fields.find((f) => f.name === name)
          const filter = field && branchWhere(field.type, context)
          if (enabled && filter)
            count.select[name] = {
              ...(enabled === true ? {} : (enabled as Args)),
              where: andWhere((enabled as Args)?.where, filter),
            }
        }
        selection[key] = count
        continue
      }
      const field = fields.find((f) => f.name === key && f.kind === 'object')
      if (!field) continue
      const nested = value === true ? {} : (value as Args)
      const filter = branchWhere(field.type, context)
      if (filter && (field.isList || !field.isRequired))
        nested.where = andWhere(nested.where, filter)
      if (Object.keys(nested).length || value !== true) selection[key] = nested
      scopeRelations(field.type, nested, context)
    }
  }
}

async function assertReference(
  db: any,
  model: string,
  where: Args,
  context: BranchContext,
) {
  const filter = branchWhere(model, context)
  if (!filter) return
  if (typeof where.id === 'string' && context.created.get(model)?.has(where.id))
    return
  const found = await db[delegate(model)].findFirst({
    where: andWhere(where, filter),
    select: models.get(model)?.fields.some((field) => field.name === 'id')
      ? { id: true }
      : { branchId: true },
  })
  if (!found)
    throw new BadRequestException(
      'Data yang dipilih tidak tersedia di cabang ini.',
    )
}

async function prepareData(
  db: any,
  model: string,
  data: Args,
  context: BranchContext,
  creating: boolean,
): Promise<void> {
  if (!data || typeof data !== 'object') return
  if (context.isAdmin && !context.isSuperAdmin && globalCatalogs.has(model))
    throw new ForbiddenException(
      'Hanya super admin yang dapat mengubah katalog bersama.',
    )
  const role = typeof data.role === 'object' ? data.role?.set : data.role
  if (model === 'Staff' && role === 'SUPER_ADMIN' && !context.isSuperAdmin)
    throw new ForbiddenException(
      'Hanya super admin yang dapat mengatur peran super admin.',
    )
  if (direct.has(model)) {
    if (!context.branchId)
      throw new BadRequestException(
        'Pilih cabang sebelum mengubah data operasional.',
      )
    const requested =
      typeof data.branchId === 'object' ? data.branchId?.set : data.branchId
    if (requested && requested !== context.branchId)
      throw new ForbiddenException(
        'Data tidak dapat dipindahkan ke cabang lain.',
      )
    if (creating) {
      // Checked relation inputs cannot be mixed with an unchecked branchId.
      const checked = models
        .get(model)
        ?.fields.some(
          (field) =>
            field.kind === 'object' &&
            data[field.name] &&
            field.relationFromFields?.length,
        )
      if (checked && !data.branchId)
        data.branch = { connect: { id: context.branchId } }
      else data.branchId = context.branchId
    }
  }
  const fields = models.get(model)?.fields ?? []
  for (const field of fields.filter((f) => f.kind === 'object')) {
    if (field.name === 'branch') {
      if (data.branch && data.branch.connect?.id !== context.branchId)
        throw new ForbiddenException('Cabang tidak sesuai.')
      continue
    }
    if (field.relationFromFields?.length === 1) {
      const key = field.relationFromFields[0]
      const id = typeof data[key] === 'object' ? data[key]?.set : data[key]
      if (id) await assertReference(db, field.type, { id }, context)
    }
    const nested = data[field.name]
    if (!nested || typeof nested !== 'object') continue
    for (const operation of ['connect', 'set', 'disconnect', 'delete']) {
      if (nested[operation] === true)
        throw new BadRequestException(
          'Gunakan ID data untuk perubahan relasi cabang.',
        )
      for (const item of asArray(nested[operation]))
        if (item) await assertReference(db, field.type, item, context)
    }
    for (const item of asArray(nested.create))
      await prepareData(db, field.type, item, context, true)
    for (const item of asArray(nested.createMany?.data))
      await prepareData(db, field.type, item, context, true)
    for (const item of asArray(nested.update)) {
      if (item.where) await assertReference(db, field.type, item.where, context)
      await prepareData(db, field.type, item.data ?? item, context, false)
    }
    for (const item of asArray(nested.updateMany)) {
      const filter = branchWhere(field.type, context)
      if (filter) item.where = andWhere(item.where, filter)
      await prepareData(db, field.type, item.data, context, false)
    }
    for (const item of asArray(nested.deleteMany)) {
      const filter = branchWhere(field.type, context)
      if (filter) Object.assign(item, andWhere(item, filter))
    }
    // Complex nested upserts can hide a cross-branch connection; use explicit operations instead.
    if (nested.upsert || nested.connectOrCreate)
      throw new BadRequestException(
        'Gunakan operasi relasi eksplisit untuk data cabang.',
      )
  }
}
const asArray = (value: any): any[] =>
  value == null || value === false ? [] : Array.isArray(value) ? value : [value]

export async function scopeBranchOperation(
  db: any,
  model: string,
  operation: string,
  args: Args,
  context: BranchContext,
): Promise<Args> {
  if (writes.has(operation)) {
    if (context.isAdmin && !context.isSuperAdmin && globalCatalogs.has(model))
      throw new ForbiddenException(
        'Hanya super admin yang dapat mengubah katalog bersama.',
      )
    if (!context.branchId && (direct.has(model) || parents[model]))
      throw new BadRequestException(
        'Pilih satu cabang sebelum melakukan perubahan.',
      )
    if (model === 'Staff') {
      for (const data of [args.data, args.create, args.update]
        .flat()
        .filter(Boolean)) {
        const role = typeof data.role === 'object' ? data.role?.set : data.role
        if (role === 'SUPER_ADMIN' && !context.isSuperAdmin)
          throw new ForbiddenException(
            'Hanya super admin yang dapat mengatur peran super admin.',
          )
      }
    }
    for (const data of asArray(args.data))
      await prepareData(
        db,
        model,
        data,
        context,
        operation.startsWith('create'),
      )
    if (args.create) await prepareData(db, model, args.create, context, true)
    if (args.update) await prepareData(db, model, args.update, context, false)
  }
  const filter = branchWhere(model, context)
  if (filter && !operation.startsWith('create'))
    args.where = andWhere(args.where, filter)
  scopeRelations(model, args, context)
  return args
}

export function branchScopedClient<T extends { $extends: any }>(client: T) {
  return client.$extends({
    name: 'branch-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          const context = branchContext.getStore()
          if (!context) return query(args)
          const prepared = await scopeBranchOperation(
            client,
            model,
            operation,
            args,
            context,
          )
          const result = await query(prepared)
          if (
            writes.has(operation) &&
            operation !== 'delete' &&
            operation !== 'deleteMany'
          ) {
            for (const item of asArray(result))
              if (item?.id) {
                if (!context.created.has(model))
                  context.created.set(model, new Set())
                context.created.get(model)!.add(item.id)
              }
          }
          return result
        },
      },
    },
  })
}
