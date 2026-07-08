import { BookingStatus, CourtSport } from '@prisma/client'
import dayjs from 'dayjs'

type InventoryAvailabilityParams = {
  courtSport?: CourtSport
  startAt?: string
  endAt?: string
}

type InventoryAvailabilityItem = {
  id: string
  name: string
  description: string | null
  sport: CourtSport
  price: number
  totalQuantity: number
  availableQuantity: number
}

const sumByInventoryId = (
  rows: Array<{ inventoryId: string; _sum: { quantity: number | null } }>,
) => {
  const map = new Map<string, number>()

  for (const row of rows) {
    map.set(row.inventoryId, row._sum.quantity ?? 0)
  }

  return map
}

export async function getInventoryAvailability(
  db: any,
  params: InventoryAvailabilityParams,
): Promise<InventoryAvailabilityItem[]> {
  const inventories = await db.inventory.findMany({
    where: {
      isActive: true,
      ...(params.courtSport ? { sport: params.courtSport } : {}),
    },
    orderBy: {
      name: 'asc',
    },
  })

  if (inventories.length === 0) {
    return []
  }

  const inventoryIds = inventories.map((inventory: { id: string }) => inventory.id)
  const hasTimeRange = Boolean(params.startAt && params.endAt)

  if (!hasTimeRange) {
    return inventories
      .map((inventory: any) => ({
        id: inventory.id,
        name: inventory.name,
        description: inventory.description,
        sport: inventory.sport,
        price: inventory.price,
        totalQuantity: inventory.quantity,
        availableQuantity: inventory.quantity,
      }))
      .filter((item: InventoryAvailabilityItem) => item.availableQuantity > 0)
  }

  const startDateTime = dayjs(params.startAt).toDate()
  const endDateTime = dayjs(params.endAt).toDate()

  const [activeBookedTotals, overlappingBookedTotals] = await Promise.all([
    db.bookingInventory.groupBy({
      by: ['inventoryId'],
      where: {
        inventoryId: { in: inventoryIds },
        booking: {
          status: {
            not: BookingStatus.CANCELLED,
          },
        },
      },
      _sum: {
        quantity: true,
      },
    }),
    db.bookingInventory.groupBy({
      by: ['inventoryId'],
      where: {
        inventoryId: { in: inventoryIds },
        booking: {
          status: {
            not: BookingStatus.CANCELLED,
          },
          details: {
            some: {
              slot: {
                startAt: {
                  lt: endDateTime,
                },
                endAt: {
                  gt: startDateTime,
                },
              },
            },
          },
        },
      },
      _sum: {
        quantity: true,
      },
    }),
  ])

  const activeBookedByInventoryId = sumByInventoryId(activeBookedTotals)
  const overlappingBookedByInventoryId = sumByInventoryId(overlappingBookedTotals)

  return inventories
    .map((inventory: any) => {
      const totalQuantity =
        inventory.quantity + (activeBookedByInventoryId.get(inventory.id) ?? 0)
      const unavailableQuantity = overlappingBookedByInventoryId.get(inventory.id) ?? 0
      const availableQuantity = Math.max(0, totalQuantity - unavailableQuantity)

      return {
        id: inventory.id,
        name: inventory.name,
        description: inventory.description,
        sport: inventory.sport,
        price: inventory.price,
        totalQuantity,
        availableQuantity,
      }
    })
    .filter((item: InventoryAvailabilityItem) => item.availableQuantity > 0)
}

export async function getInventoryAvailabilityMap(
  db: any,
  params: InventoryAvailabilityParams,
) {
  const availability = await getInventoryAvailability(db, params)
  return new Map(availability.map((item) => [item.id, item]))
}
