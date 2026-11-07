import { expect, it } from 'vitest'
import { assertClientCheckoutAddOnsAllowed } from './client-checkout-policy'
it('allows court-only selections and empty legacy add-on arrays', () => {
  expect(() => assertClientCheckoutAddOnsAllowed({})).not.toThrow()
  expect(() =>
    assertClientCheckoutAddOnsAllowed({
      inventories: [],
      coachSlots: [],
      ballboySlots: [],
    }),
  ).not.toThrow()
})
it.each(['coachSlots', 'inventories'])(
  'rejects %s in customer promo or checkout selections',
  (key) => {
    expect(() =>
      assertClientCheckoutAddOnsAllowed({ [key]: ['selected-item'] }),
    ).toThrow('Coach dan perlengkapan hanya dapat dipesan melalui admin.')
  },
)

it('allows customers to purchase ballboy slots independently', () => {
  expect(() =>
    assertClientCheckoutAddOnsAllowed({ ballboySlots: ['ballboy-slot'] }),
  ).not.toThrow()
})
