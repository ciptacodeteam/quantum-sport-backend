import { CourtSport } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { getInventoryAvailability } from './inventory-availability.service'

const inventory = {
  id: 'racket-1',
  name: 'Tennis Racket',
  description: null,
  image: null,
  sport: CourtSport.TENNIS,
  price: 50_000,
  quantity: 0,
  isActive: true,
}

function createDb(overlappingQuantity: number) {
  return {
    inventory: {
      findMany: vi.fn().mockResolvedValue([inventory]),
    },
    bookingInventory: {
      groupBy: vi
        .fn()
        // The only physical racket is currently checked out.
        .mockResolvedValueOnce([
          { inventoryId: inventory.id, _sum: { quantity: 1 } },
        ])
        // It may or may not overlap the time being queried.
        .mockResolvedValueOnce(
          overlappingQuantity > 0
            ? [
                {
                  inventoryId: inventory.id,
                  _sum: { quantity: overlappingQuantity },
                },
              ]
            : [],
        ),
    },
  }
}

describe('getInventoryAvailability', () => {
  it('makes a rented-out racket available for a non-overlapping slot', async () => {
    const availability = await getInventoryAvailability(createDb(0), {
      courtSport: CourtSport.TENNIS,
      startAt: '2026-09-05T10:00:00.000Z',
      endAt: '2026-09-05T11:00:00.000Z',
    })

    expect(availability[0]).toMatchObject({
      totalQuantity: 1,
      availableQuantity: 1,
    })
  })

  it('keeps a rented-out racket unavailable during its booked slot', async () => {
    const availability = await getInventoryAvailability(createDb(1), {
      courtSport: CourtSport.TENNIS,
      startAt: '2026-09-04T10:00:00.000Z',
      endAt: '2026-09-04T11:00:00.000Z',
    })

    expect(availability[0]).toMatchObject({
      totalQuantity: 1,
      availableQuantity: 0,
    })
  })

  it('keeps a genuinely zero-stock racket unavailable', async () => {
    const db = createDb(0)
    db.bookingInventory.groupBy
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const availability = await getInventoryAvailability(db, {
      courtSport: CourtSport.TENNIS,
      startAt: '2026-09-05T10:00:00.000Z',
      endAt: '2026-09-05T11:00:00.000Z',
    })

    expect(availability[0]).toMatchObject({
      totalQuantity: 0,
      availableQuantity: 0,
    })
  })
})
