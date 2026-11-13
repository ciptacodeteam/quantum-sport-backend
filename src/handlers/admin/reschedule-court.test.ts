vi.mock('@/services/tariff-policy.service', () => ({
  getTariffPeriods: vi.fn().mockResolvedValue([]),
}))
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  coaches: vi.fn(),
  serviceTarget: vi.fn(),
  charge: vi.fn(),
  prior: vi.fn(),
  detail: vi.fn(),
  slot: vi.fn(),
  updateSlot: vi.fn(),
  claimSlot: vi.fn(),
  transaction: vi.fn(),
  updateDetail: vi.fn(),
  updateBooking: vi.fn(),
}))
vi.mock('@/services/reschedule-charge.service', () => ({
  recordRescheduleCharge: mocks.charge,
}))
vi.mock('@/lib/create-app', () => ({
  factory: { createHandlers: (...handlers: unknown[]) => handlers },
}))
vi.mock('@/lib/prisma', () => ({
  db: {
    $transaction: (fn: (tx: unknown) => unknown, options?: unknown) => {
      mocks.transaction(options)
      return fn({
        $queryRaw: vi.fn(),
        booking: {
          findMany: mocks.prior,
          findUnique: vi.fn().mockResolvedValue({ adminNote: 'Catatan awal' }),
          update: mocks.updateBooking,
        },
        bookingCoach: { findMany: mocks.coaches },
        bookingBallboy: { findMany: vi.fn().mockResolvedValue([]) },
        bookingDetail: { findUnique: mocks.detail, update: mocks.updateDetail },
        slot: {
          findUnique: mocks.slot,
          findFirst: mocks.serviceTarget,
          update: mocks.updateSlot,
          updateMany: mocks.claimSlot,
        },
      })
    },
  },
}))
import { rescheduleCourtBookingHandler } from './booked-court.handler'

function setup(source: 'PADEL' | 'TENNIS', target: 'PADEL' | 'TENNIS') {
  mocks.coaches.mockResolvedValue([])
  mocks.prior.mockResolvedValue([])
  mocks.charge.mockResolvedValue(null)
  const oldSlot = {
    id: 'old',
    court: { sport: source },
    startAt: new Date('2040-01-05T02:00:00Z'),
    endAt: new Date('2040-01-05T03:00:00Z'),
  }
  const newSlot = {
    id: 'new',
    type: 'COURT',
    courtId: 'target-court',
    court: { sport: target, branchId: 'cemara', isActive: true },
    price: 150000,
    isAvailable: true,
    startAt: new Date('2040-01-06T02:00:00Z'),
    endAt: new Date('2040-01-06T03:00:00Z'),
  }
  mocks.detail.mockResolvedValue({
    id: 'detail',
    slotId: 'old',
    price: 150000,
    slot: oldSlot,
    court: { sport: source },
    booking: {
      id: 'booking',
      branchId: 'cemara',
      status: 'CONFIRMED',
      coaches: [],
      invoice: null,
      totalPrice: 150000,
    },
  })
  mocks.slot.mockResolvedValue(newSlot)
  mocks.updateSlot.mockResolvedValue({})
  mocks.claimSlot.mockResolvedValue({ count: 1 })
  mocks.updateDetail.mockResolvedValue({
    id: 'detail',
    slot: newSlot,
    court: newSlot.court,
    price: 150000,
  })
}
beforeEach(() => vi.clearAllMocks())
const execute = (
  role = 'CASHIER',
  requestedRole?: string,
  input: Record<string, unknown> = {},
) =>
  (rescheduleCourtBookingHandler[2] as any)({
    get: () => ({ id: 'actor', role }),
    req: {
      valid: (key: string) =>
        key === 'param'
          ? { id: 'detail' }
          : {
              newSlotId: 'new',
              ...input,
              ...(requestedRole ? { role: requestedRole } : {}),
            },
    },
    var: { logger: { fatal: vi.fn() } },
    json: (body: unknown, status: number) => ({ body, status }),
  })

it.each([
  ['PADEL', 'TENNIS'],
  ['TENNIS', 'PADEL'],
] as const)(
  'rejects %s to %s before changing any booking or slot',
  async (source, target) => {
    setup(source, target)
    await expect(execute()).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('olahraga yang sama'),
    })
    expect(mocks.updateSlot).not.toHaveBeenCalled()
    expect(mocks.updateDetail).not.toHaveBeenCalled()
  },
)
it.each(['PADEL', 'TENNIS'] as const)(
  'allows %s rescheduling to the same sport',
  async (sport) => {
    setup(sport, sport)
    expect((await execute()).status).toBe(200)
    expect(mocks.updateDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { slotId: 'new', price: 150000, courtId: 'target-court' },
      }),
    )
  },
)
it('uses the original slot court when a legacy detail has no direct court relation', async () => {
  setup('PADEL', 'TENNIS')
  const detail = await mocks.detail()
  mocks.detail.mockResolvedValue({ ...detail, court: null })
  await expect(execute()).rejects.toMatchObject({ status: 400 })
  expect(mocks.updateSlot).not.toHaveBeenCalled()
})
it('rejects an unknown original sport without touching the booking', async () => {
  setup('PADEL', 'PADEL')
  const detail = await mocks.detail()
  mocks.detail.mockResolvedValue({
    ...detail,
    court: null,
    slot: { ...detail.slot, court: null },
  })
  await expect(execute()).rejects.toMatchObject({ status: 400 })
  expect(mocks.updateSlot).not.toHaveBeenCalled()
})

it('rejects a Tennis target outside Cemara without changing the original booking', async () => {
  setup('TENNIS', 'TENNIS')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({
    ...target,
    court: { sport: 'TENNIS', branchId: 's-parman', isActive: true },
  })
  await expect(execute()).rejects.toThrow(
    'Tennis hanya tersedia di cabang Cemara.',
  )
  expect(mocks.updateSlot).not.toHaveBeenCalled()
  expect(mocks.updateDetail).not.toHaveBeenCalled()
})

it.each([
  ['2040-01-03T02:00:00.000+07:00', true],
  ['2040-01-03T01:59:59.999+07:00', true],
  ['2040-01-03T02:00:00.001+07:00', false],
  ['2040-01-04T02:00:00.000+07:00', false],
  ['2040-01-05T02:00:00.000+07:00', false],
])('enforces H-2 directly in the admin API at %s', async (now, allowed) => {
  setup('PADEL', 'PADEL')
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))
  try {
    if (allowed) expect((await execute()).status).toBe(200)
    else {
      await expect(execute()).rejects.toThrow('minimal 48 jam')
      expect(mocks.claimSlot).not.toHaveBeenCalled()
      expect(mocks.updateSlot).not.toHaveBeenCalled()
      expect(mocks.updateDetail).not.toHaveBeenCalled()
    }
  } finally {
    vi.useRealTimers()
  }
})

it.each(['HOLD', 'CANCELLED'])(
  'rejects rescheduling a %s booking',
  async (status) => {
    setup('PADEL', 'PADEL')
    const detail = await mocks.detail()
    mocks.detail.mockResolvedValue({
      ...detail,
      booking: { ...detail.booking, status },
    })
    await expect(execute()).rejects.toThrow('Hanya booking terkonfirmasi')
    expect(mocks.claimSlot).not.toHaveBeenCalled()
  },
)

it('rejects an unpaid invoice even if the booking status was changed to confirmed', async () => {
  setup('PADEL', 'PADEL')
  const detail = await mocks.detail()
  mocks.detail.mockResolvedValue({
    ...detail,
    booking: { ...detail.booking, invoice: { status: 'PENDING' } },
  })
  await expect(execute()).rejects.toThrow('Pembayaran harus lunas')
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it('rejects moving a booking to another branch', async () => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({
    ...target,
    court: { ...target.court, branchId: 's-parman' },
  })
  await expect(execute()).rejects.toThrow('cabang yang sama')
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it('rejects changes in duration', async () => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({
    ...target,
    endAt: new Date(target.endAt.getTime() + 3600000),
  })
  await expect(execute()).rejects.toThrow('Durasi jadwal pengganti')
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it('does not change a paid invoice amount during rescheduling', async () => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({ ...target, price: 200000 })
  await expect(execute()).rejects.toThrow('Periksa dan konfirmasi')
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it('does not release the old slot when another request has claimed the target', async () => {
  setup('PADEL', 'PADEL')
  mocks.claimSlot.mockResolvedValue({ count: 0 })
  await expect(execute()).rejects.toThrow('baru saja dipesan')
  expect(mocks.updateSlot).not.toHaveBeenCalled()
  expect(mocks.updateDetail).not.toHaveBeenCalled()
  expect(mocks.claimSlot).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        isAvailable: true,
        bookingDetails: { none: { booking: { status: { not: 'CANCELLED' } } } },
      }),
    }),
  )
  expect(mocks.transaction).toHaveBeenCalledWith({
    isolationLevel: 'Serializable',
  })
})

it('rejects a target outside the membership package hours', async () => {
  setup('PADEL', 'PADEL')
  const detail = await mocks.detail()
  const target = await mocks.slot()
  mocks.detail.mockResolvedValue({
    ...detail,
    discountPrice: 0,
    booking: {
      ...detail.booking,
      membershipUserId: 'pack-user',
      membershipUser: { membership: { type: 'HAPPY_HOUR' } },
    },
  })
  mocks.slot.mockResolvedValue({
    ...target,
    // Wall-clock peak hour (outside HAPPY_HOUR 06:00–15:00)
    startAt: new Date('2040-01-06T16:00:00Z'),
    endAt: new Date('2040-01-06T17:00:00Z'),
  })
  await expect(execute()).rejects.toThrow('ketentuan membership')
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it.each([
  { isAvailable: false },
  { court: { sport: 'PADEL', branchId: 'cemara', isActive: false } },
  {
    startAt: new Date('2020-01-01T02:00:00Z'),
    endAt: new Date('2020-01-01T03:00:00Z'),
  },
])('rejects unavailable, inactive or elapsed targets %j', async (patch) => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({ ...target, ...patch })
  await expect(execute()).rejects.toMatchObject({ status: 400 })
  expect(mocks.claimSlot).not.toHaveBeenCalled()
  expect(mocks.updateSlot).not.toHaveBeenCalled()
})

it('allows an eligible membership move without changing a paid invoice total', async () => {
  setup('PADEL', 'PADEL')
  const detail = await mocks.detail()
  const target = await mocks.slot()
  mocks.detail.mockResolvedValue({
    ...detail,
    discountPrice: 0,
    booking: {
      ...detail.booking,
      membershipUserId: 'pack-user',
      courtDiscountPrice: 0,
      totalPrice: 0,
      invoice: { id: 'invoice', status: 'PAID', total: 0 },
      membershipUser: { membership: { type: 'ALL_HOUR' } },
    },
  })
  mocks.slot.mockResolvedValue({ ...target, price: 200000 })
  const result = await execute()
  expect(result.body.data.priceDifference).toBe(0)
  expect(result.body.data.updatedBooking.totalPrice).toBe(0)
})

it.each([
  '2040-01-04T02:00:00+07:00',
  '2040-01-05T02:29:59.999+07:00',
])(
  'allows only super admin to bypass the original booking deadline at %s',
  async (now) => {
    setup('PADEL', 'PADEL')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    try {
      await expect(execute('CASHIER')).rejects.toThrow('minimal 48 jam')
      await expect(execute('ADMIN')).rejects.toThrow('minimal 48 jam')
      expect(mocks.claimSlot).not.toHaveBeenCalled()
      expect((await execute('SUPER_ADMIN')).status).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  },
)
it.each(['2040-01-05T02:30:00+07:00', '2040-01-05T02:30:00.001+07:00', '2040-01-05T04:00:00+07:00'])(
  'rejects super-admin rescheduling at or after 30 minutes at %s',
  async (now) => {
    setup('PADEL', 'PADEL')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    try {
      await expect(execute('SUPER_ADMIN')).rejects.toThrow('ditutup 30 menit')
      expect(mocks.claimSlot).not.toHaveBeenCalled()
      expect(mocks.updateDetail).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  },
)
it('still rejects an unavailable target for super admin despite the deadline exemption', async () => {
  setup('PADEL', 'PADEL')
  mocks.slot.mockResolvedValue({ ...(await mocks.slot()), isAvailable: false })
  await expect(execute('SUPER_ADMIN')).rejects.toThrow('no longer available')
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it('does not accept a forged super-admin role from the request body', async () => {
  setup('PADEL', 'PADEL')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2040-01-05T02:30:00+07:00'))
  try {
    await expect(execute('CASHIER', 'SUPER_ADMIN')).rejects.toThrow(
      'minimal 48 jam',
    )
  } finally {
    vi.useRealTimers()
  }
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})
it('still forbids a past replacement slot for super admin', async () => {
  setup('PADEL', 'PADEL')
  vi.useFakeTimers({ toFake: ['Date'] })
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({ ...target, startAt: new Date('2040-01-04T01:00:00Z'), endAt: new Date('2040-01-04T02:00:00Z') })
  vi.setSystemTime(new Date('2040-01-05T02:29:00+07:00'))
  try {
    await expect(execute('SUPER_ADMIN')).rejects.toThrow('already passed')
  } finally {
    vi.useRealTimers()
  }
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it('persists a structured reschedule marker while preserving existing notes', async () => {
  setup('PADEL', 'PADEL')
  await execute()
  expect(mocks.updateBooking).toHaveBeenCalledWith({
    where: { id: 'booking' },
    data: {
      adminNote: expect.stringContaining('Catatan awal\n[COURT_RESCHEDULE] '),
    },
  })
  const note = mocks.updateBooking.mock.calls[0][0].data.adminNote
  const audit = JSON.parse(note.split('[COURT_RESCHEDULE] ')[1])
  expect(audit).toMatchObject({
    actorId: 'actor',
    bookingId: 'booking',
    from: { startAt: '2040-01-05T02:00:00+07:00' },
    to: { startAt: '2040-01-06T02:00:00+07:00' },
  })
})

it('previews a higher target without changing any slot or collecting payment', async () => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({ ...target, price: 250000 })
  const result = await execute('CASHIER', undefined, { preview: true })
  expect(result.body.data.priceDifference).toBe(100000)
  expect(mocks.claimSlot).not.toHaveBeenCalled()
  expect(mocks.charge).not.toHaveBeenCalled()
})
it('charges only an approved increase using a new receipt and preserves original paid prices', async () => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({ ...target, price: 250000 })
  mocks.charge.mockResolvedValue({ id: 'extra-invoice' })
  const result = await execute('CASHIER', undefined, {
    expectedDifference: 100000,
    paymentMethodId: 'cash',
  })
  expect(result.body.data.priceDifference).toBe(100000)
  expect(result.body.data.additionalInvoiceId).toBe('extra-invoice')
  expect(mocks.charge).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ courtAmount: 100000 }),
    expect.objectContaining({ paymentMethodId: 'cash' }),
  )
  expect(mocks.updateDetail).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ price: 150000 }),
    }),
  )
})
it('allows peak to happy without refund and uses prior paid increases as the floor for future moves', async () => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({ ...target, price: 100000 })
  const result = await execute()
  expect(result.body.data.priceDifference).toBe(0)
  expect(mocks.updateDetail).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ price: 150000 }),
    }),
  )
  mocks.prior.mockResolvedValue([
    {
      invoice: {
        payment: {
          meta: {
            source: 'ADMIN_COURT_RESCHEDULE',
            detailId: 'detail',
            courtBookingId: 'booking',
            courtAmount: 100000,
            services: [],
          },
        },
      },
    },
  ])
  mocks.slot.mockResolvedValue({ ...target, price: 250000 })
  expect(
    (await execute('CASHIER', undefined, { preview: true })).body.data
      .priceDifference,
  ).toBe(0)
  mocks.slot.mockResolvedValue({ ...target, price: 300000 })
  expect(
    (await execute('CASHIER', undefined, { preview: true })).body.data
      .priceDifference,
  ).toBe(50000)
})
it('rejects a stale surcharge quote before collecting or changing any slot', async () => {
  setup('PADEL', 'PADEL')
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({ ...target, price: 250000 })
  await expect(
    execute('CASHIER', undefined, { expectedDifference: 50000 }),
  ).rejects.toThrow('Selisih biaya berubah')
  expect(mocks.charge).not.toHaveBeenCalled()
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})

it('quotes the target coaching court tariff plus only the increased coach fee', async () => {
  setup('PADEL', 'PADEL')
  const current = await mocks.detail()
  mocks.detail.mockResolvedValue({ ...current, discountPrice: 105000 })
  const target = await mocks.slot()
  mocks.slot.mockResolvedValue({
    ...target,
    price: 350000,
    startAt: new Date('2040-01-06T16:00:00Z'),
    endAt: new Date('2040-01-06T17:00:00Z'),
  })
  const { getTariffPeriods } = await import('@/services/tariff-policy.service')
  vi.mocked(getTariffPeriods).mockResolvedValueOnce([
    {
      branchId: 'cemara',
      sport: 'PADEL',
      effectiveFrom: new Date('2039-01-01'),
      happyStart: 6,
      happyEnd: 15,
      peakStart: 15,
      peakEnd: 24,
      happyCoachDiscount: 45000,
      peakCoachDiscount: 25000,
    },
  ] as any)
  mocks.coaches.mockResolvedValue([
    {
      id: 'coach',
      bookingId: 'booking',
      courtSlotId: 'old',
      slotId: 'old-coach',
      price: 150000,
      description: 'Jumlah member: 1',
      slot: {
        ...current.slot,
        id: 'old-coach',
        staffId: 'coach',
        staff: { name: 'Coach' },
      },
    },
  ])
  mocks.serviceTarget.mockResolvedValue({ id: 'new-coach', price: 200000 })
  const result = await execute('CASHIER', undefined, { preview: true })
  expect(result.body.data).toMatchObject({
    targetCourtPrice: 325000,
    courtDifference: 220000,
    serviceDifference: 50000,
    priceDifference: 270000,
  })
  expect(mocks.claimSlot).not.toHaveBeenCalled()
})
