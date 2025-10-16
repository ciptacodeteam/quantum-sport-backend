import type { SearchQuerySchema } from './validation'

type FindManyOptions = {
  skip?: number
  take?: number
  orderBy?: Record<string, 'asc' | 'desc'> | { [key: string]: any }
  where?: Record<string, any>
}

export function buildFindManyOptions(
  query: SearchQuerySchema,
  opts?: {
    defaultOrderBy?: Record<string, 'asc' | 'desc'>
    searchableFields?: string[]
  },
): FindManyOptions {
  const { page, limit, sortBy, order, search, from, to } = query

  const skip = page && limit ? (parseInt(page) - 1) * parseInt(limit) : undefined
  const take = limit ? parseInt(limit) : undefined

  const orderBy = sortBy
    ? { [sortBy]: order ? order : 'asc' }
    : opts?.defaultOrderBy || { createdAt: 'desc' }

  const where: Record<string, any> = {}

  if (search && opts?.searchableFields?.length) {
    where.OR = opts.searchableFields.map((field) => ({ [field]: { contains: search } }))
  }

  // optional: date range filtering when `from` and/or `to` provided
  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = new Date(from)
    if (to) where.createdAt.lte = new Date(to)
  }

  return {
    skip,
    take,
    orderBy,
    where: Object.keys(where).length ? where : undefined,
  }
}

export default buildFindManyOptions
