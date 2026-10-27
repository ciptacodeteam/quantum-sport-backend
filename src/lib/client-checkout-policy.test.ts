import { expect, it } from 'vitest'
import { assertClientCheckoutHasNoAddOns } from './client-checkout-policy'
it('allows court-only selections and empty legacy add-on arrays', () => {
  expect(() => assertClientCheckoutHasNoAddOns({})).not.toThrow()
  expect(() =>
    assertClientCheckoutHasNoAddOns({
      inventories: [],
      coachSlots: [],
      ballboySlots: [],
    }),
  ).not.toThrow()
})
it.each(['coachSlots', 'ballboySlots', 'inventories'])(
  'rejects %s in customer promo or checkout selections',
  (key) => {
    expect(() =>
      assertClientCheckoutHasNoAddOns({ [key]: ['selected-item'] }),
    ).toThrow('Add-ons hanya dapat dipesan melalui admin.')
  },
)
