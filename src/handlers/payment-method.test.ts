import { expect, it, vi } from 'vitest'
const methods = [
  {
    id: 'va',
    channel: 'BCA_VIRTUAL_ACCOUNT',
    isActive: true,
    isOffline: false,
  },
  { id: 'qris', channel: 'QRIS', isActive: true, isOffline: false },
  { id: 'offline-qris', channel: 'QRIS', isActive: true, isOffline: true },
  { id: 'edc', channel: 'EDC', isActive: true },
  { id: 'static', channel: 'QRIS_STATIC', isActive: true },
  { id: 'transfer', channel: 'BANK_TRANSFER_MANUAL', isActive: true },
]
vi.mock('@/lib/prisma', () => ({
  db: {
    paymentMethod: {
      findMany: async (args: any) =>
        methods.filter(
          (m) =>
            (!args?.where?.isActive || m.isActive) &&
            (args?.where?.isOffline !== false ||
              !('isOffline' in m && m.isOffline)) &&
            (!args?.where?.OR ||
              args.where.OR.some(({ channel }: any) =>
                typeof channel === 'string'
                  ? channel === m.channel
                  : channel?.endsWith && m.channel.endsWith(channel.endsWith),
              )),
        ),
    },
  },
}))
import { getCustomerPaymentMethodsHandler } from './payment-method.handler'
import { isSupportedChannel } from '@/services/midtrans.service'
it('exposes online payments to customers while hiding all manual admin payment channels', async () => {
  const response = await (getCustomerPaymentMethodsHandler.at(-1) as any)({
    json: (value: unknown) => value,
  })
  expect(response.data.map((method: any) => method.id)).toEqual(['va', 'qris'])
})
it.each(['EDC', 'QRIS_STATIC', 'BANK_TRANSFER_MANUAL'])(
  'does not treat %s as a gateway checkout channel',
  (channel) => {
    expect(isSupportedChannel(channel)).toBe(false)
  },
)
