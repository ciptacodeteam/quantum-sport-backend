import { expect, it } from 'vitest'
import { db } from '@/lib/prisma'
import {
  membershipAtPurchase,
  snapshotMembership,
} from '@/lib/membership-purchase'
import { getMembershipTracking } from './membership-tracking.service'
import { getCourtPerformance } from './court-performance.service'
import { getIncomeBySourceAnalytics } from './analytics.service'
import { activateMembershipAfterPayment } from './membership-activation.service'
import { withBranchContext } from '@/lib/branch-context'

const run = process.env.RUN_MEMBERSHIP_SNAPSHOT_DB_TESTS === '1' ? it : it.skip
run(
  'keeps purchased terms, activation, cash revenue and court allocation after a catalogue edit',
  async () => {
    const id = `purchase-snapshot-${Date.now()}`
    const paidAt = new Date('2026-10-01T03:00:00Z')
    const original = {
      price: 10000000,
      sessions: 50,
      duration: 91,
      type: 'ALL_HOUR' as const,
    }
    try {
      await db.branch.create({ data: { id, name: id, address: 'Test' } })
      await db.user.create({
        data: { id, name: id, phone: id, password: 'test-only' },
      })
      await db.court.create({ data: { id, name: id, branchId: id } })
      await db.membership.create({ data: { id, name: id, ...original } })
      await db.membershipUser.create({
        data: {
          id,
          userId: id,
          membershipId: id,
          ...snapshotMembership(original),
          startDate: paidAt,
          endDate: new Date('2027-01-01T03:00:00Z'),
          remainingSessions: 49,
          remainingDuration: 91,
        },
      })
      await db.invoice.create({
        data: {
          id,
          number: id,
          branchId: id,
          userId: id,
          membershipUserId: id,
          subtotal: original.price,
          processingFee: 100000,
          total: 10100000,
          status: 'PAID',
          paidAt,
          dueDate: paidAt,
        },
      })
      await db.slot.create({
        data: {
          id,
          branchId: id,
          courtId: id,
          type: 'COURT',
          startAt: new Date('2026-10-01T14:00:00Z'),
          endAt: new Date('2026-10-01T15:00:00Z'),
          price: 300000,
          isAvailable: false,
        },
      })
      await db.booking.create({
        data: {
          id,
          branchId: id,
          userId: id,
          membershipUserId: id,
          status: 'CONFIRMED',
          membershipSessionsUsed: 1,
          details: {
            create: {
              id,
              slotId: id,
              courtId: id,
              price: 300000,
              discountPrice: 0,
            },
          },
        },
      })
      const before = await getCourtPerformance('2026-10-01', '2026-10-01', id)
      await db.membership.update({
        where: { id },
        data: {
          price: 12500000,
          sessions: 100,
          duration: 30,
          type: 'HAPPY_HOUR',
        },
      })
      const after = await getCourtPerformance('2026-10-01', '2026-10-01', id)
      expect(after.summary.membershipAllocation).toBe(200000)
      expect(after.summary.membershipAllocation).toBe(
        before.summary.membershipAllocation,
      )
      expect(after.summary.unvaluedMembershipHours).toBe(0)
      const income = await withBranchContext(
        { branchId: id, isAdmin: true, isSuperAdmin: true },
        () =>
          getIncomeBySourceAnalytics(
            new Date('2026-10-01T00:00:00Z'),
            new Date('2026-10-02T00:00:00Z'),
          ),
      )
      expect(income.summary.membershipIncome).toBe(10000000)
      await db.$transaction((tx) =>
        activateMembershipAfterPayment(tx, id, paidAt),
      )
      const purchased = await db.membershipUser.findUniqueOrThrow({
        where: { id },
        include: { membership: true },
      })
      expect(membershipAtPurchase(purchased).membership).toMatchObject(original)
      expect(purchased.endDate.getTime() - purchased.startDate.getTime()).toBe(
        91 * 86400000,
      )
      expect(purchased.remainingSessions).toBe(49)
      const tracking = await getMembershipTracking(id)
      expect(tracking.packages[0]).toMatchObject({
        totalHours: 50,
        type: 'ALL_HOUR',
        remainingHours: 49,
      })
    } finally {
      await db.bookingDetail.deleteMany({ where: { bookingId: id } })
      await db.booking.deleteMany({ where: { id } })
      await db.slot.deleteMany({ where: { id } })
      await db.invoice.deleteMany({ where: { id } })
      await db.membershipUser.deleteMany({ where: { id } })
      await db.membership.deleteMany({ where: { id } })
      await db.court.deleteMany({ where: { id } })
      await db.user.deleteMany({ where: { id } })
      await db.branch.deleteMany({ where: { id } })
    }
  },
)
