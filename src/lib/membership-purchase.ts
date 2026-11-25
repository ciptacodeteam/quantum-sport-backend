import { BadRequestException } from '@/exceptions'
import type { MembershipType } from '@prisma/client'

type Purchase = {
  purchasedPrice?: number | null
  purchasedSessions?: number | null
  purchasedDuration?: number | null
  purchasedType?: MembershipType | null
}

export function snapshotMembership(membership: {
  price: number
  sessions: number
  duration: number
  type: MembershipType
}) {
  return {
    purchasedPrice: membership.price,
    purchasedSessions: membership.sessions,
    purchasedDuration: membership.duration,
    purchasedType: membership.type,
  }
}

/** Preserve the API shape while reading the terms of this purchase. */
export function membershipAtPurchase<
  T extends Purchase & { membership: object },
>(pack: T): T {
  const membership = { ...pack.membership }
  const fields = {
    price: pack.purchasedPrice,
    sessions: pack.purchasedSessions,
    duration: pack.purchasedDuration,
    type: pack.purchasedType,
  }
  for (const [field, value] of Object.entries(fields)) {
    if (!(field in membership)) continue
    if (value == null)
      throw new BadRequestException(
        'Ketentuan pembelian Value Pack lama belum terverifikasi. Hubungi admin untuk memeriksa data pembelian.',
      )
    Object.assign(membership, { [field]: value })
  }
  return { ...pack, membership }
}
