import { expect, it } from 'vitest'
import { getCourtSlotStatus } from './court-slot-status'
it('distinguishes holds, confirmed bookings, manual closures and availability', () => {
 expect(getCourtSlotStatus(false, ['HOLD'])).toBe('ON_HOLD')
 expect(getCourtSlotStatus(false, ['CONFIRMED'])).toBe('BOOKED')
 expect(getCourtSlotStatus(true, ['HOLD'])).toBe('ON_HOLD')
 expect(getCourtSlotStatus(false, [])).toBe('UNAVAILABLE')
 expect(getCourtSlotStatus(true, ['CANCELLED'])).toBe('AVAILABLE')
 expect(getCourtSlotStatus(true, [])).toBe('AVAILABLE')
 expect(getCourtSlotStatus(false, ['HOLD', 'CONFIRMED'])).toBe('BOOKED')
})
