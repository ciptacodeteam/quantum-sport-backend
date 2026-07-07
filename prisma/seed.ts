import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/password'
import dayjs from 'dayjs'

const db = new PrismaClient()

// ==================== USERS ====================
async function seedUsers() {
  console.info('👥 Seeding users...')
  const hashedPassword = await hashPassword('Password123!')

  const users = [
    {
      name: 'John Smith',
      email: 'john.smith@example.com',
      phone: '+6281234567890',
      phoneVerified: true,
      emailVerified: true,
      password: hashedPassword,
      banned: false,
    },
    {
      name: 'Sarah Johnson',
      email: 'sarah.johnson@example.com',
      phone: '+6281234567891',
      phoneVerified: true,
      emailVerified: false,
      password: hashedPassword,
      banned: false,
    },
    {
      name: 'Michael Chen',
      email: 'michael.chen@example.com',
      phone: '+6281234567892',
      phoneVerified: true,
      emailVerified: true,
      password: hashedPassword,
      banned: false,
    },
    {
      name: 'Emma Williams',
      email: 'emma.williams@example.com',
      phone: '+6281234567893',
      phoneVerified: false,
      emailVerified: true,
      password: hashedPassword,
      banned: false,
    },
    {
      name: 'Banned User',
      email: 'banned@example.com',
      phone: '+6281234567894',
      phoneVerified: true,
      emailVerified: true,
      password: hashedPassword,
      banned: true,
      banReason: 'Violated terms of service',
      banExpires: dayjs().add(30, 'days').toDate(),
    },
  ]

  const createdUsers: any[] = []
  for (const userData of users) {
    const user = await db.user.upsert({
      where: { email: userData.email },
      update: {},
      create: userData,
    })
    createdUsers.push(user)
    console.info(`✅ User: ${user.name}`)
  }
  return createdUsers
}

// ==================== STAFF ====================
async function seedStaff() {
  console.info('👔 Seeding staff...')
  const hashedPassword = await hashPassword('Staff123!')

  const staff = [
    {
      name: 'Admin User',
      email: 'admin@quantum.com',
      phone: '+6281100000001',
      password: hashedPassword,
      role: 'ADMIN' as const,
      isActive: true,
      joinedAt: dayjs().subtract(2, 'years').toDate(),
    },
    {
      name: 'Viewer Admin',
      email: 'viewer@quantum.com',
      phone: '+6281100000008',
      password: hashedPassword,
      role: 'ADMIN_VIEWER' as const,
      isActive: true,
      joinedAt: dayjs().subtract(1, 'month').toDate(),
    },
    {
      name: 'Cashier One',
      email: 'cashier1@quantum.com',
      phone: '+6281100000002',
      password: hashedPassword,
      role: 'CASHIER' as const,
      isActive: true,
      joinedAt: dayjs().subtract(1, 'year').toDate(),
    },
    {
      name: 'Cashier Two',
      email: 'cashier2@quantum.com',
      phone: '+6281100000003',
      password: hashedPassword,
      role: 'CASHIER' as const,
      isActive: true,
      joinedAt: dayjs().subtract(6, 'months').toDate(),
    },
    {
      name: 'Coach Andy Murray',
      email: 'andy.murray@quantum.com',
      phone: '+6281100000004',
      password: hashedPassword,
      role: 'COACH' as const,
      coachType: 'PADEL_TENNIS' as const,
      coachProfile: [
        'Former national-level tennis competitor',
        'Specialist in match strategy and doubles positioning',
        '10+ years coaching junior and adult players',
      ].join('\n'),
      isActive: true,
      joinedAt: dayjs().subtract(1, 'year').toDate(),
    },
    {
      name: 'Coach Maria Sharapova',
      email: 'maria.sharapova@quantum.com',
      phone: '+6281100000005',
      password: hashedPassword,
      role: 'COACH' as const,
      coachType: 'PADEL' as const,
      coachProfile: [
        'Certified performance coach for beginner to advanced players',
        'Focus on footwork, serve technique, and rally consistency',
        'Experienced in private sessions and group training programs',
      ].join('\n'),
      isActive: true,
      joinedAt: dayjs().subtract(6, 'months').toDate(),
    },
    {
      name: 'Ballboy James',
      email: 'james.ballboy@quantum.com',
      phone: '+6281100000006',
      password: hashedPassword,
      role: 'BALLBOY' as const,
      isActive: true,
      joinedAt: dayjs().subtract(3, 'months').toDate(),
    },
    {
      name: 'Ballboy Tim (Inactive)',
      email: 'tim.ballboy@quantum.com',
      phone: '+6281100000007',
      password: hashedPassword,
      role: 'BALLBOY' as const,
      isActive: false,
      joinedAt: dayjs().subtract(1, 'year').toDate(),
    },
  ]

  const createdStaff: any[] = []
  for (const staffData of staff) {
    const staffMember = await db.staff.upsert({
      where: { email: staffData.email },
      update: {},
      create: staffData,
    })
    createdStaff.push(staffMember)
    console.info(`✅ Staff: ${staffMember.name} (${staffMember.role})`)
  }
  return createdStaff
}

// ==================== COURTS ====================
async function seedCourts() {
  console.info('🎾 Seeding courts...')

  const courts = [
    {
      name: 'Court A - Indoor Premium',
      description: 'Premium indoor court with AC and lighting',
      sport: 'PADEL' as const,
      isActive: true,
    },
    {
      name: 'Court B - Outdoor Clay',
      description: 'Professional clay court for advanced players',
      sport: 'PADEL' as const,
      isActive: true,
    },
    {
      name: 'Court C - Indoor Standard',
      description: 'Standard indoor court for casual play',
      sport: 'TENNIS' as const,
      isActive: true,
    },
    {
      name: 'Court D - Outdoor Hard',
      description: 'Hard surface outdoor court',
      sport: 'TENNIS' as const,
      isActive: true,
    },
    {
      name: 'Court E - Maintenance',
      description: 'Court under maintenance',
      sport: 'PADEL' as const,
      isActive: false,
    },
  ]

  const createdCourts: any[] = []
  for (const courtData of courts) {
    const court = await db.court.upsert({
      where: { name: courtData.name },
      update: {},
      create: courtData,
    })
    createdCourts.push(court)
    console.info(`✅ Court: ${court.name}`)
  }
  return createdCourts
}

// ==================== INVENTORIES ====================
async function seedInventories() {
  console.info('🎯 Seeding inventories...')

  const inventories = [
    {
      name: 'Tennis Racket - Wilson Pro',
      description: 'Professional grade racket',
      quantity: 10,
      price: 50000,
      isActive: true,
    },
    {
      name: 'Tennis Balls - Set of 3',
      description: 'Premium tennis balls',
      quantity: 50,
      price: 25000,
      isActive: true,
    },
    {
      name: 'Water Bottle',
      description: 'Sports water bottle',
      quantity: 30,
      price: 15000,
      isActive: true,
    },
    {
      name: 'Towel',
      description: 'Sports towel',
      quantity: 20,
      price: 20000,
      isActive: true,
    },
    {
      name: 'Out of Stock Item',
      description: 'Currently unavailable',
      quantity: 0,
      price: 10000,
      isActive: false,
    },
  ]

  const createdInventories: any[] = []
  for (const invData of inventories) {
    const inventory = await db.inventory.upsert({
      where: { name: invData.name },
      update: {},
      create: invData,
    })
    createdInventories.push(inventory)
    console.info(
      `✅ Inventory: ${inventory.name} (Stock: ${inventory.quantity})`,
    )
  }
  return createdInventories
}

// ==================== PAYMENT METHODS ====================
async function seedPaymentMethods() {
  console.info('💳 Seeding payment methods...')

  const methods = [
    {
      name: 'BCA Virtual Account',
      channel: 'VA',
      fees: 4000,
      percentage: 0,
      isActive: true,
    },
    {
      name: 'Mandiri Virtual Account',
      channel: 'VA',
      fees: 4000,
      percentage: 0,
      isActive: true,
    },
    {
      name: 'GoPay',
      channel: 'EWALLET',
      fees: 0,
      percentage: 2,
      isActive: true,
    },
    { name: 'OVO', channel: 'EWALLET', fees: 0, percentage: 2, isActive: true },
    { name: 'QRIS', channel: 'QRIS', fees: 0, percentage: 0.7, isActive: true },
    { name: 'Cash', channel: 'CASH', fees: 0, percentage: 0, isActive: true },
  ]

  const createdMethods: any[] = []
  for (const methodData of methods) {
    const method = await db.paymentMethod.upsert({
      where: { name: methodData.name },
      update: {},
      create: methodData,
    })
    createdMethods.push(method)
    console.info(`✅ Payment: ${method.name}`)
  }
  return createdMethods
}

// ==================== BANNERS ====================
async function seedBanners() {
  console.info('🎨 Seeding banners...')

  const banners = [
    {
      image: 'https://picsum.photos/1200/400?random=1',
      link: '/promotions/grand-opening',
      isActive: true,
      startAt: dayjs().subtract(7, 'days').toDate(),
      endAt: dayjs().add(23, 'days').toDate(),
      sequence: 1,
    },
    {
      image: 'https://picsum.photos/1200/400?random=2',
      link: '/classes',
      isActive: true,
      startAt: dayjs().toDate(),
      endAt: dayjs().add(30, 'days').toDate(),
      sequence: 2,
    },
    {
      image: 'https://picsum.photos/1200/400?random=3',
      isActive: true,
      sequence: 3,
    },
    {
      image: 'https://picsum.photos/1200/400?random=4',
      isActive: false,
      sequence: 4,
    },
    {
      image: 'https://picsum.photos/1200/400?random=5',
      link: '/tournaments',
      isActive: true,
      startAt: dayjs().add(1, 'day').toDate(),
      endAt: dayjs().add(60, 'days').toDate(),
      sequence: 5,
    },
  ]

  for (const bannerData of banners) {
    await db.banner.create({ data: bannerData })
  }
  console.info(`✅ Created ${banners.length} banners`)
}

// ==================== PARTNERSHIPS ====================
async function seedPartnerships() {
  console.info('🤝 Seeding partnerships...')

  const partnerships = [
    {
      name: 'Nike Sports',
      description: 'Official sportswear partner',
      logo: 'https://picsum.photos/200/200?random=10',
      isActive: true,
    },
    {
      name: 'Gatorade',
      description: 'Official hydration partner',
      logo: 'https://picsum.photos/200/200?random=11',
      isActive: true,
    },
    {
      name: 'Wilson',
      description: 'Official equipment supplier',
      logo: 'https://picsum.photos/200/200?random=12',
      isActive: true,
    },
    {
      name: 'Adidas',
      description: 'Premium sportswear',
      logo: 'https://picsum.photos/200/200?random=13',
      isActive: true,
    },
    {
      name: 'Past Partner',
      description: 'Expired partnership',
      logo: 'https://picsum.photos/200/200?random=14',
      isActive: false,
    },
  ]

  for (const partnerData of partnerships) {
    await db.partnership.upsert({
      where: { name: partnerData.name },
      update: {},
      create: partnerData,
    })
    console.info(`✅ Partnership: ${partnerData.name}`)
  }
}

// ==================== COACH TYPES ====================
async function seedCoachTypes(staff: any[]) {
  console.info('🏋️ Seeding coach types & prices...')

  const coachTypes = [
    {
      name: 'Personal Training',
      description: 'One-on-one intensive training session',
      isActive: true,
    },
    {
      name: 'Guided Match',
      description: 'Practice match with professional guidance',
      isActive: true,
    },
    {
      name: 'Group Training',
      description: 'Small group training (2-4 people)',
      isActive: true,
    },
    {
      name: 'Technique Analysis',
      description: 'Video analysis and technique improvement',
      isActive: true,
    },
    {
      name: 'Kids Training',
      description: 'Specialized training for children',
      isActive: true,
    },
  ]

  const createdCoachTypes: any[] = []
  for (const typeData of coachTypes) {
    const coachType = await db.bookingCoachType.upsert({
      where: { name: typeData.name },
      update: {},
      create: typeData,
    })
    createdCoachTypes.push(coachType)
    console.info(`✅ Coach Type: ${coachType.name}`)
  }

  // Set prices for active coaches
  const coaches = staff.filter((s) => s.role === 'COACH' && s.isActive)
  for (const coach of coaches) {
    for (let i = 0; i < createdCoachTypes.length; i++) {
      const basePrice = coach.name.includes('Andy') ? 300000 : 250000
      await db.coachTypeStaffPrice.upsert({
        where: {
          staffId_coachTypeId: {
            staffId: coach.id,
            coachTypeId: createdCoachTypes[i].id,
          },
        },
        update: {},
        create: {
          staffId: coach.id,
          coachTypeId: createdCoachTypes[i].id,
          basePrice: BigInt(basePrice + i * 50000),
        },
      })
    }
  }
  console.info(`✅ Set coach type prices for ${coaches.length} coaches`)

  return createdCoachTypes
}

// ==================== SLOTS ====================
async function seedSlots(courts: any[], staff: any[]) {
  console.info('📅 Seeding slots (courts, coaches, ballboys)...')

  const today = dayjs().startOf('day')
  const coaches = staff.filter((s) => s.role === 'COACH' && s.isActive)
  const ballboys = staff.filter((s) => s.role === 'BALLBOY' && s.isActive)
  const activeCourts = courts.filter((c) => c.isActive)

  let slotCount = 0

  // Court slots - Next 3 days, 8 AM to 8 PM
  for (let day = 0; day < 3; day++) {
    for (let hour = 8; hour < 20; hour++) {
      for (const court of activeCourts.slice(0, 3)) {
        const startAt = today.add(day, 'day').add(hour, 'hour').toDate()
        const endAt = today
          .add(day, 'day')
          .add(hour + 1, 'hour')
          .toDate()
        const price = court.name.includes('Premium')
          ? 150000
          : court.name.includes('Clay')
            ? 120000
            : 100000

        await db.slot.create({
          data: {
            type: 'COURT',
            courtId: court.id,
            startAt,
            endAt,
            price,
            isAvailable: true,
          },
        })
        slotCount++
      }
    }
  }

  // Coach slots - Next 3 days, 9 AM to 5 PM
  for (let day = 0; day < 3; day++) {
    for (let hour = 9; hour < 17; hour += 2) {
      for (const coach of coaches) {
        const startAt = today.add(day, 'day').add(hour, 'hour').toDate()
        const endAt = today
          .add(day, 'day')
          .add(hour + 2, 'hour')
          .toDate()

        await db.slot.create({
          data: {
            type: 'COACH',
            staffId: coach.id,
            startAt,
            endAt,
            price: 300000,
            isAvailable: true,
          },
        })
        slotCount++
      }
    }
  }

  // Ballboy slots - Next 3 days, 8 AM to 8 PM
  for (let day = 0; day < 3; day++) {
    for (let hour = 8; hour < 20; hour += 2) {
      for (const ballboy of ballboys) {
        const startAt = today.add(day, 'day').add(hour, 'hour').toDate()
        const endAt = today
          .add(day, 'day')
          .add(hour + 2, 'hour')
          .toDate()

        await db.slot.create({
          data: {
            type: 'BALLBOY',
            staffId: ballboy.id,
            startAt,
            endAt,
            price: 50000,
            isAvailable: true,
          },
        })
        slotCount++
      }
    }
  }

  console.info(`✅ Created ${slotCount} slots`)
  return slotCount
}

// ==================== BOOKINGS ====================
async function seedBookings(
  users: any[],
  courts: any[],
  staff: any[],
  inventories: any[],
  paymentMethods: any[],
  coachTypes: any[],
) {
  console.info('📝 Seeding bookings with various scenarios...')

  // const today = dayjs().startOf('day')
  const cashiers = staff.filter((s) => s.role === 'CASHIER')

  // Scenario 1: CONFIRMED booking with court + inventory (PAID) - handled by cashier
  const courtSlot1 = await db.slot.findFirst({
    where: { type: 'COURT', isAvailable: true, courtId: courts[0].id },
  })
  if (courtSlot1) {
    const booking1 = await db.booking.create({
      data: {
        userId: users[0].id,
        status: 'CONFIRMED',
        totalPrice: 175000,
        processingFee: 0,
        cashierId: cashiers[0]?.id, // Handled by first cashier
      },
    })

    await db.slot.update({
      where: { id: courtSlot1.id },
      data: { isAvailable: false },
    })
    await db.bookingDetail.create({
      data: {
        bookingId: booking1.id,
        slotId: courtSlot1.id,
        courtId: courts[0].id,
        price: 150000,
      },
    })

    await db.bookingInventory.create({
      data: {
        bookingId: booking1.id,
        inventoryId: inventories[1].id,
        quantity: 1,
        price: 25000,
      },
    })

    const payment1 = await db.payment.create({
      data: {
        paymentMethodId: paymentMethods[5].id, // Cash
        status: 'PAID',
        amount: 175000,
        fees: 0,
        externalRef: 'CASH-001',
        paidAt: dayjs().toDate(),
      },
    })

    await db.invoice.create({
      data: {
        bookingId: booking1.id,
        number: 'INV-2025-001',
        userId: users[0].id,
        paymentId: payment1.id,
        subtotal: 175000,
        processingFee: 0,
        total: 175000,
        status: 'PAID',
        issuedAt: dayjs().toDate(),
        dueDate: dayjs().add(1, 'day').toDate(),
        paidAt: dayjs().toDate(),
      },
    })

    console.info(
      `✅ Booking 1: CONFIRMED with court + inventory (PAID by cashier)`,
    )
  }

  // Scenario 2: HOLD booking (pending payment)
  const courtSlot2 = await db.slot.findFirst({
    where: { type: 'COURT', isAvailable: true, courtId: courts[1].id },
  })
  if (courtSlot2) {
    const booking2 = await db.booking.create({
      data: {
        userId: users[1].id,
        status: 'HOLD',
        totalPrice: 120000,
        processingFee: 4000,
        holdExpiresAt: dayjs().add(1, 'hour').toDate(),
      },
    })

    await db.slot.update({
      where: { id: courtSlot2.id },
      data: { isAvailable: false },
    })
    await db.bookingDetail.create({
      data: {
        bookingId: booking2.id,
        slotId: courtSlot2.id,
        courtId: courts[1].id,
        price: 120000,
      },
    })

    const payment2 = await db.payment.create({
      data: {
        paymentMethodId: paymentMethods[1].id,
        status: 'AWAITING_CONFIRMATION',
        amount: 124000,
        fees: 4000,
        externalRef: 'MANDIRI-VA-002',
        dueDate: dayjs().add(1, 'day').toDate(),
      },
    })

    await db.invoice.create({
      data: {
        bookingId: booking2.id,
        number: 'INV-2025-002',
        userId: users[1].id,
        paymentId: payment2.id,
        subtotal: 120000,
        processingFee: 4000,
        total: 124000,
        status: 'AWAITING_CONFIRMATION',
        issuedAt: dayjs().toDate(),
        dueDate: dayjs().add(1, 'day').toDate(),
      },
    })

    console.info(`✅ Booking 2: HOLD (pending payment)`)
  }

  // Scenario 3: CONFIRMED booking with court + coach + ballboy
  const courtSlot3 = await db.slot.findFirst({
    where: { type: 'COURT', isAvailable: true, courtId: courts[2].id },
  })
  const coachSlot = await db.slot.findFirst({
    where: { type: 'COACH', isAvailable: true },
  })
  const ballboySlot = await db.slot.findFirst({
    where: { type: 'BALLBOY', isAvailable: true },
  })

  if (courtSlot3 && coachSlot && ballboySlot) {
    const booking3 = await db.booking.create({
      data: {
        userId: users[2].id,
        status: 'CONFIRMED',
        totalPrice: 450000,
        processingFee: 0,
        cashierId: cashiers[1]?.id, // Handled by second cashier
      },
    })

    await db.slot.update({
      where: { id: courtSlot3.id },
      data: { isAvailable: false },
    })
    await db.bookingDetail.create({
      data: {
        bookingId: booking3.id,
        slotId: courtSlot3.id,
        courtId: courts[2].id,
        price: 100000,
      },
    })

    await db.slot.update({
      where: { id: coachSlot.id },
      data: { isAvailable: false },
    })
    await db.bookingCoach.create({
      data: {
        bookingId: booking3.id,
        slotId: coachSlot.id,
        bookingCoachTypeId: coachTypes[0].id,
        price: 300000,
      },
    })

    await db.slot.update({
      where: { id: ballboySlot.id },
      data: { isAvailable: false },
    })
    await db.bookingBallboy.create({
      data: {
        bookingId: booking3.id,
        slotId: ballboySlot.id,
        price: 50000,
      },
    })

    const payment3 = await db.payment.create({
      data: {
        paymentMethodId: paymentMethods[5].id, // Cash
        status: 'PAID',
        amount: 450000,
        fees: 0,
        externalRef: 'CASH-003',
        paidAt: dayjs().toDate(),
      },
    })

    await db.invoice.create({
      data: {
        bookingId: booking3.id,
        number: 'INV-2025-003',
        userId: users[2].id,
        paymentId: payment3.id,
        subtotal: 450000,
        processingFee: 0,
        total: 450000,
        status: 'PAID',
        issuedAt: dayjs().toDate(),
        dueDate: dayjs().add(1, 'day').toDate(),
        paidAt: dayjs().toDate(),
      },
    })

    console.info(`✅ Booking 3: CONFIRMED with court + coach + ballboy`)
  }

  // Scenario 4: CANCELLED booking
  const courtSlot4 = await db.slot.findFirst({
    where: { type: 'COURT', isAvailable: true, courtId: courts[0].id },
    skip: 1,
  })
  if (courtSlot4) {
    const booking4 = await db.booking.create({
      data: {
        userId: users[3].id,
        status: 'CANCELLED',
        totalPrice: 150000,
        processingFee: 4000,
        cancelledAt: dayjs().subtract(1, 'day').toDate(),
        cancellationReason: 'User requested cancellation',
      },
    })

    await db.bookingDetail.create({
      data: {
        bookingId: booking4.id,
        slotId: courtSlot4.id,
        courtId: courts[0].id,
        price: 150000,
      },
    })

    const payment4 = await db.payment.create({
      data: {
        paymentMethodId: paymentMethods[0].id,
        status: 'CANCELLED',
        amount: 154000,
        fees: 4000,
        externalRef: 'BCA-VA-004',
        cancelledAt: dayjs().subtract(1, 'day').toDate(),
      },
    })

    await db.invoice.create({
      data: {
        bookingId: booking4.id,
        number: 'INV-2025-004',
        userId: users[3].id,
        paymentId: payment4.id,
        subtotal: 150000,
        processingFee: 4000,
        total: 154000,
        status: 'CANCELLED',
        issuedAt: dayjs().subtract(1, 'day').toDate(),
        dueDate: dayjs().toDate(),
        cancelledAt: dayjs().subtract(1, 'day').toDate(),
      },
    })

    console.info(`✅ Booking 4: CANCELLED`)
  }

  // Scenario 5: EXPIRED payment
  const courtSlot5 = await db.slot.findFirst({
    where: { type: 'COURT', isAvailable: true, courtId: courts[1].id },
    skip: 1,
  })
  if (courtSlot5) {
    const booking5 = await db.booking.create({
      data: {
        userId: users[0].id,
        status: 'CANCELLED',
        totalPrice: 120000,
        processingFee: 0,
        cancelledAt: dayjs().subtract(2, 'days').toDate(),
        cancellationReason: 'Payment expired',
      },
    })

    await db.bookingDetail.create({
      data: {
        bookingId: booking5.id,
        slotId: courtSlot5.id,
        courtId: courts[1].id,
        price: 120000,
      },
    })

    const payment5 = await db.payment.create({
      data: {
        paymentMethodId: paymentMethods[4].id,
        status: 'EXPIRED',
        amount: 120840,
        fees: 840,
        externalRef: 'QRIS-005',
        dueDate: dayjs().subtract(2, 'days').toDate(),
      },
    })

    await db.invoice.create({
      data: {
        bookingId: booking5.id,
        number: 'INV-2025-005',
        userId: users[0].id,
        paymentId: payment5.id,
        subtotal: 120000,
        processingFee: 840,
        total: 120840,
        status: 'EXPIRED',
        issuedAt: dayjs().subtract(3, 'days').toDate(),
        dueDate: dayjs().subtract(2, 'days').toDate(),
      },
    })

    console.info(`✅ Booking 5: EXPIRED payment`)
  }
}

// ==================== MEMBERSHIPS ====================
async function seedMemberships(users: any[], paymentMethods: any[]) {
  console.info('💎 Seeding memberships...')

  const memberships = [
    {
      name: 'Bronze Member',
      description: 'Entry-level membership',
      content: 'Basic access to courts and facilities',
      sport: 'PADEL' as const,
      price: 500000,
      sessions: 10,
      duration: 30,
      sequence: 1,
      isActive: true,
    },
    {
      name: 'Silver Member',
      description: 'Mid-tier membership with benefits',
      content: 'Priority booking and discounts',
      sport: 'PADEL' as const,
      price: 1000000,
      sessions: 25,
      duration: 60,
      sequence: 2,
      isActive: true,
    },
    {
      name: 'Gold Member',
      description: 'Premium membership',
      content: 'All access with exclusive perks',
      sport: 'TENNIS' as const,
      price: 2000000,
      sessions: 60,
      duration: 90,
      sequence: 3,
      isActive: true,
    },
    {
      name: 'Platinum Member',
      description: 'VIP membership',
      content: 'Unlimited access with personal coach',
      sport: 'TENNIS' as const,
      price: 5000000,
      sessions: 120,
      duration: 180,
      sequence: 4,
      isActive: true,
    },
    {
      name: 'Old Package',
      description: 'Discontinued membership',
      content: 'No longer available',
      sport: 'PADEL' as const,
      price: 300000,
      sessions: 5,
      duration: 15,
      sequence: 5,
      isActive: false,
    },
  ]

  const createdMemberships: any[] = []
  for (const membershipData of memberships) {
    const membership = await db.membership.upsert({
      where: { name: membershipData.name },
      update: {},
      create: membershipData,
    })
    createdMemberships.push(membership)

    // Add benefits
    const benefits = [
      `${membershipData.sessions} hours of court time`,
      `Valid for ${membershipData.duration} days`,
      'Priority customer support',
    ]
    for (const benefit of benefits) {
      await db.membershipBenefit.create({
        data: {
          membershipId: membership.id,
          benefit,
        },
      })
    }

    console.info(`✅ Membership: ${membership.name}`)
  }

  // Assign memberships to users
  // Active membership
  const membershipUser1 = await db.membershipUser.create({
    data: {
      userId: users[0].id,
      membershipId: createdMemberships[1].id,
      startDate: dayjs().subtract(10, 'days').toDate(),
      endDate: dayjs().add(50, 'days').toDate(),
      remainingSessions: 20,
      remainingDuration: 50,
      isExpired: false,
      isSuspended: false,
    },
  })

  const payment = await db.payment.create({
    data: {
      paymentMethodId: paymentMethods[0].id,
      status: 'PAID',
      amount: 1000000,
      fees: 4000,
      paidAt: dayjs().subtract(10, 'days').toDate(),
    },
  })

  await db.invoice.create({
    data: {
      membershipUserId: membershipUser1.id,
      number: 'INV-MEM-001',
      userId: users[0].id,
      paymentId: payment.id,
      subtotal: 1000000,
      processingFee: 4000,
      total: 1004000,
      status: 'PAID',
      issuedAt: dayjs().subtract(10, 'days').toDate(),
      dueDate: dayjs().subtract(9, 'days').toDate(),
      paidAt: dayjs().subtract(10, 'days').toDate(),
    },
  })

  // Expired membership
  await db.membershipUser.create({
    data: {
      userId: users[1].id,
      membershipId: createdMemberships[0].id,
      startDate: dayjs().subtract(60, 'days').toDate(),
      endDate: dayjs().subtract(30, 'days').toDate(),
      remainingSessions: 0,
      remainingDuration: 0,
      isExpired: true,
      isSuspended: false,
    },
  })

  // Suspended membership
  await db.membershipUser.create({
    data: {
      userId: users[2].id,
      membershipId: createdMemberships[2].id,
      startDate: dayjs().subtract(20, 'days').toDate(),
      endDate: dayjs().add(70, 'days').toDate(),
      remainingSessions: 45,
      remainingDuration: 70,
      isExpired: false,
      isSuspended: true,
      suspensionReason: 'Violation of club rules',
      suspensionEndDate: dayjs().add(7, 'days').toDate(),
    },
  })

  console.info(`✅ Created 3 membership users`)
}

// ==================== CLASSES ====================
async function seedClasses(users: any[], paymentMethods: any[]) {
  console.info('📚 Seeding classes...')

  const classes = [
    {
      name: 'Beginner Tennis Bootcamp',
      description: 'Learn the fundamentals of tennis',
      content: 'Comprehensive beginner course covering basics',
      organizerName: 'Quantum Sports Academy',
      speakerName: 'Coach Andy Murray',
      startDate: dayjs().add(5, 'days').toDate(),
      endDate: dayjs().add(19, 'days').toDate(),
      startTime: '09:00',
      endTime: '11:00',
      price: 500000,
      sessions: 10,
      capacity: 20,
      remaining: 15,
      maxBookingPax: 2,
      gender: 'ALL' as const,
      ageMin: 10,
      isActive: true,
    },
    {
      name: 'Advanced Women Training',
      description: 'Professional training for women',
      content: 'Advanced techniques and strategies',
      organizerName: 'Quantum Sports',
      speakerName: 'Coach Maria Sharapova',
      startDate: dayjs().add(7, 'days').toDate(),
      endDate: dayjs().add(28, 'days').toDate(),
      startTime: '14:00',
      endTime: '16:00',
      price: 750000,
      sessions: 15,
      capacity: 10,
      remaining: 8,
      maxBookingPax: 1,
      gender: 'FEMALE' as const,
      ageMin: 18,
      isActive: true,
    },
    {
      name: 'Men Elite Training',
      description: 'Competitive training for men',
      content: 'High-intensity professional training',
      organizerName: 'Quantum Pro',
      speakerName: 'Coach Andy Murray',
      startDate: dayjs().add(10, 'days').toDate(),
      endDate: dayjs().add(31, 'days').toDate(),
      startTime: '16:00',
      endTime: '18:00',
      price: 800000,
      sessions: 12,
      capacity: 8,
      remaining: 3,
      maxBookingPax: 1,
      gender: 'MALE' as const,
      ageMin: 16,
      isActive: true,
    },
    {
      name: 'Kids Tennis Fun',
      description: 'Fun tennis for kids',
      content: 'Playful introduction to tennis',
      organizerName: 'Quantum Kids',
      speakerName: 'Coach Andy Murray',
      startDate: dayjs().add(3, 'days').toDate(),
      endDate: dayjs().add(17, 'days').toDate(),
      startTime: '10:00',
      endTime: '11:30',
      price: 400000,
      sessions: 8,
      capacity: 15,
      remaining: 10,
      maxBookingPax: 3,
      gender: 'ALL' as const,
      ageMin: 6,
      isActive: true,
    },
    {
      name: 'Past Class',
      description: 'Already completed',
      startDate: dayjs().subtract(30, 'days').toDate(),
      endDate: dayjs().subtract(10, 'days').toDate(),
      startTime: '09:00',
      endTime: '11:00',
      price: 300000,
      sessions: 5,
      capacity: 10,
      remaining: 0,
      maxBookingPax: 1,
      gender: 'ALL' as const,
      ageMin: 10,
      isActive: false,
    },
  ]

  const createdClasses: any[] = []
  for (const classData of classes) {
    const classItem = await db.class.create({ data: classData })
    createdClasses.push(classItem)
    console.info(`✅ Class: ${classItem.name}`)
  }

  // Create class booking (CONFIRMED)
  const classBooking1 = await db.classBooking.create({
    data: {
      classId: createdClasses[0].id,
      userId: users[0].id,
      status: 'CONFIRMED',
      totalPrice: 500000,
      processingFee: 4000,
    },
  })

  for (let i = 0; i < 5; i++) {
    await db.classBookingDetail.create({
      data: {
        classBookingId: classBooking1.id,
        date: dayjs()
          .add(5 + i * 3, 'days')
          .toDate(),
        time: '09:00',
        price: 50000,
        attendance: i < 2,
      },
    })
  }

  const payment = await db.payment.create({
    data: {
      paymentMethodId: paymentMethods[2].id,
      status: 'PAID',
      amount: 514000,
      fees: 10000,
      paidAt: dayjs().subtract(1, 'day').toDate(),
    },
  })

  await db.invoice.create({
    data: {
      classBookingId: classBooking1.id,
      number: 'INV-CLASS-001',
      userId: users[0].id,
      paymentId: payment.id,
      subtotal: 500000,
      processingFee: 14000,
      total: 514000,
      status: 'PAID',
      issuedAt: dayjs().subtract(1, 'day').toDate(),
      dueDate: dayjs().toDate(),
      paidAt: dayjs().subtract(1, 'day').toDate(),
    },
  })

  console.info(`✅ Created 1 class booking`)
}

// ==================== CLUBS ====================
async function seedClubs(users: any[]) {
  console.info('🏆 Seeding clubs...')

  const clubs = [
    {
      name: 'Elite Tennis Club',
      description: 'Premier tennis club for professionals',
      rules: 'Respect all members, book in advance',
      visibility: 'PUBLIC' as const,
      leaderId: users[0].id,
      isActive: true,
    },
    {
      name: 'VIP Badminton Circle',
      description: 'Exclusive badminton club',
      rules: 'Professional conduct required',
      visibility: 'PRIVATE' as const,
      leaderId: users[1].id,
      isActive: true,
    },
    {
      name: 'Community Sports Hub',
      description: 'Open to all skill levels',
      rules: 'Open to all, respect diversity',
      visibility: 'PUBLIC' as const,
      leaderId: users[2].id,
      isActive: true,
    },
    {
      name: 'Weekend Warriors',
      description: 'Casual weekend players',
      visibility: 'PUBLIC' as const,
      leaderId: users[3].id,
      isActive: true,
    },
    {
      name: 'Inactive Club',
      description: 'No longer active',
      visibility: 'PUBLIC' as const,
      leaderId: users[0].id,
      isActive: false,
    },
  ]

  const createdClubs: any[] = []
  for (const clubData of clubs) {
    const club = await db.club.upsert({
      where: { name: clubData.name },
      update: {},
      create: clubData,
    })
    createdClubs.push(club)
    console.info(`✅ Club: ${club.name}`)
  }

  // Club members
  await db.clubMember.create({
    data: { clubId: createdClubs[0].id, userId: users[2].id },
  })
  await db.clubMember.create({
    data: { clubId: createdClubs[2].id, userId: users[1].id },
  })

  // Join requests
  await db.clubJoinRequest.create({
    data: {
      clubId: createdClubs[1].id,
      userId: users[3].id,
      status: 'PENDING',
    },
  })
  await db.clubJoinRequest.create({
    data: {
      clubId: createdClubs[0].id,
      userId: users[4].id,
      status: 'APPROVED',
    },
  })
  await db.clubJoinRequest.create({
    data: {
      clubId: createdClubs[1].id,
      userId: users[0].id,
      status: 'REJECTED',
    },
  })

  console.info(`✅ Created club members and join requests`)
  return createdClubs
}

// ==================== TOURNAMENTS ====================
async function seedTournaments() {
  console.info('🏅 Seeding tournaments...')

  const tournaments = [
    {
      name: 'Quantum Open 2025',
      description: 'Annual championship tournament',
      rules: {
        format: 'Single elimination',
        rules: ['Open to all skill levels', 'Professional conduct required'],
      },
      startDate: dayjs().add(30, 'days').toDate(),
      endDate: dayjs().add(33, 'days').toDate(),
      startTime: '08:00',
      endTime: '18:00',
      maxTeams: 32,
      teamSize: 2,
      entryFee: 500000,
      location: 'Quantum Sports Center',
      isActive: true,
    },
    {
      name: 'Summer Singles Championship',
      description: 'Individual competition',
      startDate: dayjs().add(45, 'days').toDate(),
      endDate: dayjs().add(47, 'days').toDate(),
      startTime: '09:00',
      endTime: '17:00',
      maxTeams: 16,
      teamSize: 1,
      entryFee: 300000,
      location: 'Main Court',
      isActive: true,
    },
    {
      name: 'Team Challenge Cup',
      description: 'Team-based tournament',
      startDate: dayjs().add(60, 'days').toDate(),
      endDate: dayjs().add(62, 'days').toDate(),
      startTime: '10:00',
      endTime: '16:00',
      maxTeams: 8,
      teamSize: 4,
      entryFee: 1000000,
      location: 'All Courts',
      isActive: true,
    },
    {
      name: 'Youth Championship',
      description: 'For players under 18',
      startDate: dayjs().add(20, 'days').toDate(),
      endDate: dayjs().add(21, 'days').toDate(),
      startTime: '09:00',
      endTime: '15:00',
      maxTeams: 24,
      teamSize: 1,
      entryFee: 150000,
      location: 'Youth Center',
      isActive: true,
    },
    {
      name: 'Past Tournament',
      description: 'Already completed',
      startDate: dayjs().subtract(10, 'days').toDate(),
      endDate: dayjs().subtract(8, 'days').toDate(),
      startTime: '08:00',
      endTime: '18:00',
      maxTeams: 16,
      teamSize: 2,
      entryFee: 400000,
      location: 'Main Court',
      isActive: false,
    },
  ]

  for (const tournamentData of tournaments) {
    await db.tournament.create({ data: tournamentData })
    console.info(`✅ Tournament: ${tournamentData.name}`)
  }
}

// ==================== NOTIFICATIONS ====================
async function seedNotifications(users: any[]) {
  console.info('🔔 Seeding notifications...')

  const notifications = [
    {
      userId: users[0].id,
      audience: 'USER' as const,
      type: 'PAYMENT_SUCCESS' as const,
      title: 'Payment Successful',
      message: 'Your payment for booking INV-2025-001 has been confirmed',
      isRead: true,
      readAt: dayjs().subtract(1, 'hour').toDate(),
    },
    {
      userId: users[1].id,
      audience: 'USER' as const,
      type: 'BOOKING_CREATED' as const,
      title: 'Booking Created',
      message: 'Your booking is on hold. Please complete payment within 1 hour',
      isRead: false,
    },
    {
      userId: null,
      audience: 'ALL' as const,
      type: 'ADMIN_PUSH' as const,
      title: 'New Tournament Announced',
      message: 'Quantum Open 2025 registration is now open!',
      isRead: false,
    },
    {
      userId: users[0].id,
      audience: 'USER' as const,
      type: 'MEMBERSHIP_ACTIVATED' as const,
      title: 'Membership Activated',
      message: 'Your Silver membership is now active',
      isRead: true,
      readAt: dayjs().subtract(10, 'days').toDate(),
    },
    {
      userId: users[1].id,
      audience: 'USER' as const,
      type: 'PAYMENT_FAILED' as const,
      title: 'Payment Expired',
      message: 'Your payment for INV-2025-005 has expired',
      isRead: false,
    },
  ]

  for (const notifData of notifications) {
    await db.notification.create({ data: notifData })
  }
  console.info(`✅ Created ${notifications.length} notifications`)
}

// ==================== MAIN ====================
async function main() {
  console.info('🌱 Starting comprehensive database seeding\n')

  const users = await seedUsers()
  const staff = await seedStaff()
  const courts = await seedCourts()
  const inventories = await seedInventories()
  const paymentMethods = await seedPaymentMethods()
  await seedBanners()
  await seedPartnerships()
  const coachTypes = await seedCoachTypes(staff)
  await seedSlots(courts, staff)
  await seedBookings(
    users,
    courts,
    staff,
    inventories,
    paymentMethods,
    coachTypes,
  )
  await seedMemberships(users, paymentMethods)
  await seedClasses(users, paymentMethods)
  await seedClubs(users)
  await seedTournaments()
  await seedNotifications(users)

  console.info('\n✅ Database seeding completed successfully!')
  console.info('\n📊 Seed Summary:')
  console.info('   👥 5 Users (including 1 banned)')
  console.info('   👔 7 Staff (1 admin, 2 cashiers, 2 coaches, 2 ballboys)')
  console.info('   🎾 5 Courts (4 active, 1 inactive)')
  console.info('   🎯 5 Inventories')
  console.info('   💳 6 Payment Methods (including Cash)')
  console.info('   🎨 5 Banners')
  console.info('   🤝 5 Partnerships')
  console.info('   🏋️ 5 Coach Types')
  console.info('   📅 Slots (courts, coaches, ballboys for 3 days)')
  console.info(
    '   📝 5 Bookings (CONFIRMED, HOLD, CANCELLED, EXPIRED scenarios)',
  )
  console.info('   💎 5 Memberships + 3 membership users')
  console.info('   📚 5 Classes + 1 class booking')
  console.info('   🏆 5 Clubs + members + join requests')
  console.info('   🏅 5 Tournaments')
  console.info('   🔔 5 Notifications')
  console.info('\n🔑 Login Credentials:')
  console.info('   Users: john.smith@example.com | Password123!')
  console.info('   Admin: admin@quantum.com | Staff123!')
  console.info('   Cashier: cashier1@quantum.com | Staff123!')
  console.info('   Coach: andy.murray@quantum.com | Staff123!')
}

main()
  .then(async () => {
    await db.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
