import {
  Prisma,
  PrismaClient,
  BookingStatus,
  CourtSport,
  Role,
  SlotType,
  PaymentStatus,
  CoachType,
  MembershipType,
} from '@prisma/client'
import { statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import clubTime from '../src/lib/club-time'
import { hashPassword } from '../src/lib/password'

const db = new PrismaClient()
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const argument = (flag: string) => args[args.indexOf(flag) + 1]
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`
const PASSWORD = process.env.DUMMY_PASSWORD || 'DummySport2026!'
const customers = [
  'Aditya Pratama',
  'Bella Maharani',
  'Candra Wijaya',
  'Dewi Anggraini',
  'Eko Saputra',
  'Farah Putri',
  'Galih Ramadhan',
  'Hana Permata',
  'Indra Setiawan',
  'Jessica Natalia',
  'Kevin Santoso',
  'Laras Wulandari',
  'Muhammad Rizky',
  'Nadia Amelia',
  'Oscar Kurniawan',
  'Putri Anindya',
  'Qori Azzahra',
  'Raka Mahendra',
  'Salsa Nabila',
  'Taufik Hidayat',
  'Utami Lestari',
  'Vino Alexander',
  'Wulan Safitri',
  'Yudha Nugraha',
  'Zahra Kirana',
  'Arif Firmansyah',
  'Clara Monica',
  'Dimas Arya',
  'Intan Puspita',
  'Fajar Maulana',
]
const offsets = [-6, -4, -2, -1, 0, 0, 0, 0, 0, 1, 1, 2, 3, 5, 7]
const id = (...parts: (string | number)[]) => ['demo', ...parts].join('-')
const at = (date: string, hour: number) =>
  clubTime(date).hour(hour).minute(0).second(0).millisecond(0).toDate()
const priceFor = (sport: CourtSport, hour: number) =>
  sport === 'PADEL'
    ? hour < 15
      ? 150000
      : 200000
    : hour < 15
      ? 100000
      : 150000
async function batches<T>(data: T[], create: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < data.length; i += 300)
    await create(data.slice(i, i + 300))
}

async function main() {
  const target = new URL(process.env.DATABASE_URL || '')
  assert.equal(
    process.env.NODE_ENV,
    'development',
    'Demo reset only runs with NODE_ENV=development',
  )
  assert(
    ['db', 'localhost', '127.0.0.1'].includes(target.hostname),
    'Demo reset only runs against a local database',
  )
  assert.equal(target.pathname, '/quantum_sport', 'Unexpected database name')
  const branches = await db.branch.findMany({ orderBy: { sequence: 'asc' } })
  assert.deepEqual(branches.map((branch) => branch.id).sort(), [
    'cemara',
    's-parman',
  ])
  const superAdmins = await db.staff.findMany({
    where: { role: Role.SUPER_ADMIN },
    orderBy: { id: 'asc' },
  })
  assert(superAdmins.length > 0, 'No super admin found; refusing reset')
  const tokens = await db.authToken.findMany({
    where: { staffId: { in: superAdmins.map((staff) => staff.id) } },
    orderBy: { id: 'asc' },
  })
  assert(
    tokens.every((token) => token.userId === null),
    'Unexpected super admin token relation',
  )
  const enumLabels = await db.$queryRaw<
    { name: string; value: string }[]
  >`SELECT t.typname AS name, e.enumlabel AS value FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid`
  const missingEnums = Prisma.dmmf.datamodel.enums.flatMap((type) =>
    type.values
      .filter(
        (value) =>
          !enumLabels.some(
            (row) => row.name === type.name && row.value === value.name,
          ),
      )
      .map((value) => ({ name: type.name, value: value.name })),
  )
  const today = clubTime().format('YYYY-MM-DD')
  const firstDay = clubTime(today).subtract(7, 'day').format('YYYY-MM-DD')
  const lastDay = clubTime(today).add(30, 'day').format('YYYY-MM-DD')
  const plan = {
    database: { host: target.hostname, name: target.pathname.slice(1) },
    preserve: {
      branches: branches.map(({ id, name }) => ({ id, name })),
      superAdmins: superAdmins.length,
      superAdminSessions: tokens.length,
    },
    additiveSchemaUpdates: missingEnums,
    replace:
      'All other public application table data (no uploaded files or external services)',
    create: {
      courts: 8,
      tennis: 2,
      padel: 6,
      customers: 30,
      newStaff: 18,
      courtBookings: 30,
      bookingsPerSport: 15,
      inventoryItems: 8,
      membershipPlans: 6,
    },
    operatingHours: '06:00–00:00 Asia/Jakarta (18 hourly slots per day)',
    pricingWindow: { firstDay, lastDay },
  }
  console.log(JSON.stringify(plan, null, 2))
  if (!apply) {
    console.log(
      'Dry run only. Use --apply --backup-file <dump> --report-file <json> to execute.',
    )
    return
  }
  assert(args.includes('--backup-file'), 'A completed backup is required')
  const backupFile = resolve(argument('--backup-file'))
  assert(
    statSync(backupFile).isFile() && statSync(backupFile).size > 0,
    'Backup file is empty/missing',
  )
  assert(args.includes('--report-file'), 'Choose a report file inside .backups')
  const reportFile = resolve(argument('--report-file'))
  // PostgreSQL requires new enum labels to commit before a transaction can use them.
  // These are additive schema repairs only; all data replacement remains atomic below.
  for (const type of missingEnums) {
    assert(/^[A-Z_]+$/.test(type.value))
    await db.$executeRawUnsafe(
      `ALTER TYPE ${quoteIdentifier(type.name)} ADD VALUE IF NOT EXISTS '${type.value}'`,
    )
  }
  const passwordHash = await hashPassword(PASSWORD)
  const employeeAccounts: {
    role: Role
    name: string
    email: string
    branch: string
  }[] = []
  const summary = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'")
      // Preserve exact staff rows and sessions inside the same atomic reset transaction.
      await tx.$executeRawUnsafe(
        "CREATE TEMP TABLE demo_preserved_staff ON COMMIT DROP AS SELECT * FROM staff WHERE role = 'SUPER_ADMIN'",
      )
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE demo_preserved_tokens ON COMMIT DROP AS SELECT a.* FROM auth_token a JOIN staff s ON s.id = a."staffId" WHERE s.role = \'SUPER_ADMIN\'',
      )
      const tables = await tx.$queryRaw<
        { tablename: string }[]
      >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('branches', '_prisma_migrations') ORDER BY tablename`
      // Every referencing application table is listed; no CASCADE can reach the preserved branches.
      await tx.$executeRawUnsafe(
        `TRUNCATE TABLE ${tables.map(({ tablename }) => `public.${quoteIdentifier(tablename)}`).join(', ')} RESTART IDENTITY`,
      )
      await tx.$executeRawUnsafe(
        'INSERT INTO staff SELECT * FROM demo_preserved_staff',
      )
      await tx.$executeRawUnsafe(
        'INSERT INTO auth_token SELECT * FROM demo_preserved_tokens',
      )
      // Existing checkout schema repair: nullable link needed for tennis ballboy schedules.
      await tx.$executeRawUnsafe(
        'ALTER TABLE booking_ballboys ADD COLUMN IF NOT EXISTS "courtSlotId" TEXT',
      )
      await tx.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_ballboys_courtSlotId_fkey') THEN
        ALTER TABLE booking_ballboys ADD CONSTRAINT "booking_ballboys_courtSlotId_fkey" FOREIGN KEY ("courtSlotId") REFERENCES slots(id) ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;
    END $$`)
      await tx.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "booking_ballboys_courtSlotId_idx" ON booking_ballboys ("courtSlotId")',
      )

      await tx.user.createMany({
        data: customers.map((name, index) => ({
          id: id('customer', index + 1),
          name,
          email: `customer${String(index + 1).padStart(2, '0')}@demo.quantum.test`,
          phone: `+62800000${String(index + 1).padStart(4, '0')}`,
          password: passwordHash,
          emailVerified: true,
          phoneVerified: true,
          source: 'ADMIN_CREATED',
          createdAt: clubTime(today)
            .subtract(20 + (index % 10), 'day')
            .toDate(),
        })),
      })
      const staffDefinitions = [
        { key: 'admin', name: 'Admin Operasional', role: Role.ADMIN },
        { key: 'viewer', name: 'Admin Viewer', role: Role.ADMIN_VIEWER },
        { key: 'cashier-1', name: 'Kasir Pagi', role: Role.CASHIER },
        { key: 'cashier-2', name: 'Kasir Sore', role: Role.CASHIER },
        {
          key: 'coach-padel',
          name: 'Pelatih Padel',
          role: Role.COACH,
          coachType: CoachType.PADEL,
        },
        {
          key: 'coach-tennis',
          name: 'Pelatih Tenis',
          role: Role.COACH,
          coachType: CoachType.TENNIS,
        },
        {
          key: 'coach-multi',
          name: 'Pelatih Padel & Tenis',
          role: Role.COACH,
          coachType: CoachType.PADEL_TENNIS,
        },
        { key: 'ballboy-1', name: 'Ballboy Pagi', role: Role.BALLBOY },
        { key: 'ballboy-2', name: 'Ballboy Sore', role: Role.BALLBOY },
      ]
      for (const [branchIndex, branch] of branches.entries()) {
        const suffix = branch.name.replace('Black Padel ', '')
        for (const [index, definition] of staffDefinitions.entries()) {
          const email = `${definition.key}.${branch.id}@demo.quantum.test`
          const name = `${definition.name} ${suffix}`
          await tx.staff.create({
            data: {
              id: id(branch.id, definition.key),
              branchId: branch.id,
              name,
              email,
              phone: `+628001${branchIndex}${String(index + 1).padStart(4, '0')}`,
              password: passwordHash,
              role: definition.role,
              isActive: !['COACH', 'BALLBOY'].includes(definition.role),
              coachType:
                'coachType' in definition ? definition.coachType : null,
              coachProfile:
                definition.role === Role.COACH
                  ? 'Pelatih demo untuk latihan privat, teknik dasar, dan guided match.'
                  : null,
              joinedAt: clubTime(today).subtract(1, 'year').toDate(),
            },
          })
          employeeAccounts.push({
            role: definition.role,
            name,
            email,
            branch: branch.name,
          })
        }
        await tx.court.createMany({
          data: [1, 2, 3]
            .map<Prisma.CourtCreateManyInput>((number) => ({
              id: id(branch.id, 'padel', number),
              branchId: branch.id,
              name: `Padel Court ${number}`,
              sport: CourtSport.PADEL,
              description: `Lapangan padel ${suffix}. Buka setiap hari 06.00–00.00 WIB.`,
            }))
            .concat([
              {
                id: id(branch.id, 'tennis', 1),
                branchId: branch.id,
                name: 'Tennis Court 1',
                sport: CourtSport.TENNIS,
                isActive: branch.id === 'cemara',
                description: `Lapangan tenis ${suffix}. Buka setiap hari 06.00–00.00 WIB.`,
              },
            ]),
        })
        await tx.inventory.createMany({
          data: [
            {
              key: 'padel-racket',
              name: 'Raket Padel',
              sport: CourtSport.PADEL,
              price: 50000,
              quantity: 20,
            },
            {
              key: 'padel-balls',
              name: 'Bola Padel (3 bola)',
              sport: CourtSport.PADEL,
              price: 25000,
              quantity: 40,
            },
            {
              key: 'tennis-racket',
              name: 'Raket Tenis',
              sport: CourtSport.TENNIS,
              price: 40000,
              quantity: 12,
            },
            {
              key: 'tennis-balls',
              name: 'Bola Tenis (3 bola)',
              sport: CourtSport.TENNIS,
              price: 20000,
              quantity: 30,
            },
          ].map(({ key, ...item }) => ({
            id: id(branch.id, key),
            branchId: branch.id,
            ...item,
            description: 'Peralatan demo untuk pemesanan lapangan.',
          })),
        })
      }
      const coachTypes = await Promise.all(
        ['Latihan Privat', 'Guided Match'].map((name, index) =>
          tx.bookingCoachType.create({
            data: { id: id('coach-type', index), name },
          }),
        ),
      )
      const coaches = await tx.staff.findMany({ where: { role: Role.COACH } })
      await tx.coachTypeStaffPrice.createMany({
        data: coaches.flatMap((coach) =>
          coachTypes.map((type, index) => ({
            staffId: coach.id,
            coachTypeId: type.id,
            basePrice: BigInt(index === 0 ? 200000 : 150000),
          })),
        ),
      })
      const methods = await Promise.all(
        [
          { name: 'Cash', channel: 'CASH' },
          { name: 'QRIS', channel: 'QRIS' },
          { name: 'Transfer BCA', channel: 'BCA_VIRTUAL_ACCOUNT' },
        ].map((method, sequence) =>
          tx.paymentMethod.create({
            data: { id: id('payment-method', sequence), ...method, sequence },
          }),
        ),
      )
      for (const sport of [CourtSport.PADEL, CourtSport.TENNIS]) {
        for (const [sequence, definition] of [
          {
            type: MembershipType.ALL_HOUR,
            label: 'All Hour',
            sessions: 10,
            price: sport === CourtSport.PADEL ? 1500000 : 1000000,
          },
          {
            type: MembershipType.HAPPY_HOUR,
            label: 'Happy Hour',
            sessions: 10,
            price: sport === CourtSport.PADEL ? 1200000 : 800000,
          },
          {
            type: MembershipType.AFTER_HOUR,
            label: 'After Hour',
            sessions: 10,
            price: sport === CourtSport.PADEL ? 1700000 : 1200000,
          },
        ].entries()) {
          await tx.membership.create({
            data: {
              id: id('membership', sport.toLowerCase(), sequence),
              name: `${sport === CourtSport.PADEL ? 'Padel' : 'Tennis'} ${definition.label} 10 Sesi`,
              sport,
              type: definition.type,
              sessions: definition.sessions,
              price: definition.price,
              duration: 30,
              sequence,
              description: `Paket 10 sesi ${sport.toLowerCase()} ${definition.label.toLowerCase()} untuk 30 hari.`,
              branches: {
                create: branches.map((branch) => ({ branchId: branch.id })),
              },
              benefits: {
                create: [
                  { benefit: '10 sesi bermain, masing-masing 1 jam' },
                  { benefit: 'Berlaku selama 30 hari' },
                  { benefit: 'Dapat digunakan di Cemara dan S. Parman' },
                ],
              },
            },
          })
        }
      }

      const courts = await tx.court.findMany({ orderBy: { id: 'asc' } })
      const bookableStaff = await tx.staff.findMany({
        where: { role: { in: [Role.COACH, Role.BALLBOY] } },
      })
      const slots: Prisma.SlotCreateManyInput[] = []
      const prices: Prisma.CourtCostScheduleCreateManyInput[] = []
      for (let dayOffset = -7; dayOffset <= 30; dayOffset++) {
        const date = clubTime(today).add(dayOffset, 'day').format('YYYY-MM-DD')
        for (let hour = 6; hour < 24; hour++) {
          const range = { startAt: at(date, hour), endAt: at(date, hour + 1) }
          for (const court of courts) {
            const pricing = {
              branchId: court.branchId,
              courtId: court.id,
              ...range,
              price: priceFor(court.sport, hour),
            }
            slots.push({
              id: id(court.id, date, hour),
              type: SlotType.COURT,
              ...pricing,
            })
            prices.push({ id: id('price', court.id, date, hour), ...pricing })
          }
          for (const staff of bookableStaff)
            slots.push({
              id: id(staff.id, date, hour),
              branchId: staff.branchId,
              staffId: staff.id,
              type:
                staff.role === Role.COACH ? SlotType.COACH : SlotType.BALLBOY,
              ...range,
              price: staff.role === Role.COACH ? 200000 : 0,
            })
        }
      }
      await batches(slots, (data) => tx.slot.createMany({ data }))
      await batches(prices, (data) => tx.courtCostSchedule.createMany({ data }))

      for (const [branchIndex, branch] of branches.entries()) {
        for (let i = 0; i < 15; i++) {
          const number = branchIndex * 15 + i + 1
          const sport =
            (i + branchIndex) % 2 === 0 ? CourtSport.TENNIS : CourtSport.PADEL
          const court = courts.find(
            (court) =>
              court.branchId === branch.id &&
              court.sport === sport &&
              court.name.endsWith(
                String(sport === CourtSport.TENNIS ? 1 : (i % 3) + 1),
              ),
          )!
          const date = clubTime(today)
            .add(offsets[i], 'day')
            .format('YYYY-MM-DD')
          const startHour = i === 14 ? 22 : 6 + (i % 5) * 3
          const hours = [startHour, startHour + 1]
          const bookingStatus =
            i === 2
              ? BookingStatus.CANCELLED
              : i === 12 || i === 13
                ? BookingStatus.HOLD
                : BookingStatus.CONFIRMED
          const paymentStatus =
            bookingStatus === BookingStatus.CONFIRMED
              ? PaymentStatus.PAID
              : bookingStatus === BookingStatus.CANCELLED
                ? PaymentStatus.CANCELLED
                : PaymentStatus.PENDING
          const createdAt = new Date(
            Math.min(
              clubTime(date).subtract(1, 'day').hour(10).valueOf(),
              Date.now() - number * 120000,
            ),
          )
          const paidAt =
            paymentStatus === PaymentStatus.PAID
              ? new Date(createdAt.getTime() + 60000)
              : null
          const courtTotal = hours.reduce(
            (sum, hour) => sum + priceFor(sport, hour),
            0,
          )
          const withCoach =
            i % 4 === 0 && bookingStatus === BookingStatus.CONFIRMED
          const withEquipment =
            i % 3 === 0 && bookingStatus === BookingStatus.CONFIRMED
          const withBallboy =
            sport === CourtSport.TENNIS &&
            i % 3 === 1 &&
            bookingStatus === BookingStatus.CONFIRMED
          const coachFee = withCoach ? 400000 : 0
          const equipmentPrice = sport === CourtSport.PADEL ? 50000 : 40000
          const equipmentFee = withEquipment ? equipmentPrice * 4 : 0
          const total = courtTotal + coachFee + equipmentFee
          const booking = await tx.booking.create({
            data: {
              id: id('booking', number),
              branchId: branch.id,
              userId: id('customer', number),
              cashierId: id(branch.id, i % 2 === 0 ? 'cashier-1' : 'cashier-2'),
              status: bookingStatus,
              totalPrice: total,
              courtNormalPrice: courtTotal,
              createdAt,
              holdExpiresAt:
                bookingStatus === BookingStatus.HOLD
                  ? clubTime(date).hour(startHour).toDate()
                  : null,
              cancelledAt:
                bookingStatus === BookingStatus.CANCELLED
                  ? clubTime(date).subtract(1, 'day').hour(12).toDate()
                  : null,
              cancellationReason:
                bookingStatus === BookingStatus.CANCELLED
                  ? 'Pembatalan contoh untuk pengujian tampilan.'
                  : null,
              adminNote: `Data dummy ${sport.toLowerCase()} ${number}, ${branch.name}.`,
              details: {
                create: hours.map((hour) => ({
                  courtId: court.id,
                  slotId: id(court.id, date, hour),
                  price: priceFor(sport, hour),
                })),
              },
            },
          })
          const courtSlotIds = hours.map((hour) => id(court.id, date, hour))
          if (bookingStatus !== BookingStatus.CANCELLED) {
            await tx.slot.updateMany({
              where: { id: { in: courtSlotIds } },
              data: { isAvailable: false },
            })
            await tx.courtCostSchedule.updateMany({
              where: {
                courtId: court.id,
                startAt: { in: hours.map((hour) => at(date, hour)) },
              },
              data: { isAvailable: false },
            })
          }
          if (withCoach) {
            const staffId = id(
              branch.id,
              sport === CourtSport.PADEL ? 'coach-padel' : 'coach-tennis',
            )
            await tx.bookingCoach.createMany({
              data: hours.map((hour) => ({
                bookingId: booking.id,
                slotId: id(staffId, date, hour),
                bookingCoachTypeId: coachTypes[0].id,
                price: 200000,
              })),
            })
            await tx.slot.updateMany({
              where: {
                id: { in: hours.map((hour) => id(staffId, date, hour)) },
              },
              data: { isAvailable: false },
            })
          }
          if (withBallboy) {
            const staffId = id(branch.id, 'ballboy-1')
            await tx.bookingBallboy.createMany({
              data: hours.map((hour) => ({
                bookingId: booking.id,
                slotId: id(staffId, date, hour),
                courtSlotId: id(court.id, date, hour),
                price: 0,
              })),
            })
            await tx.slot.updateMany({
              where: {
                id: { in: hours.map((hour) => id(staffId, date, hour)) },
              },
              data: { isAvailable: false },
            })
          }
          if (withEquipment)
            await tx.bookingInventory.createMany({
              data: hours.map((hour) => ({
                bookingId: booking.id,
                inventoryId: id(
                  branch.id,
                  sport === CourtSport.PADEL ? 'padel-racket' : 'tennis-racket',
                ),
                slotId: id(court.id, date, hour),
                quantity: 2,
                price: equipmentPrice,
              })),
            })
          const payment = await tx.payment.create({
            data: {
              id: id('payment', number),
              paymentMethodId: methods[i % methods.length].id,
              status: paymentStatus,
              amount: total,
              createdAt,
              paidAt,
              dueDate: clubTime(date).hour(startHour).toDate(),
              cancelledAt:
                paymentStatus === PaymentStatus.CANCELLED
                  ? clubTime(date).subtract(1, 'day').hour(12).toDate()
                  : null,
              meta: {
                dummy: true,
                source: 'seed-demo',
                noGatewayRequest: true,
              },
            },
          })
          await tx.invoice.create({
            data: {
              id: id('invoice', number),
              branchId: branch.id,
              bookingId: booking.id,
              userId: id('customer', number),
              paymentId: payment.id,
              number: `DEMO-${today.replaceAll('-', '')}-${String(number).padStart(4, '0')}`,
              subtotal: total,
              total,
              status: paymentStatus,
              issuedAt: createdAt,
              dueDate: clubTime(date).hour(startHour).toDate(),
              paidAt,
              cancelledAt:
                paymentStatus === PaymentStatus.CANCELLED
                  ? clubTime(date).subtract(1, 'day').hour(12).toDate()
                  : null,
            },
          })
        }
      }
      assert.deepEqual(
        await tx.branch.findMany({ orderBy: { sequence: 'asc' } }),
        branches,
        'Branch data changed',
      )
      assert.deepEqual(
        await tx.staff.findMany({
          where: { role: Role.SUPER_ADMIN },
          orderBy: { id: 'asc' },
        }),
        superAdmins,
        'Super admin data changed',
      )
      assert.deepEqual(
        await tx.authToken.findMany({
          where: { staffId: { in: superAdmins.map((staff) => staff.id) } },
          orderBy: { id: 'asc' },
        }),
        tokens,
        'Super admin sessions changed',
      )
      assert.equal(await tx.user.count(), 30)
      assert.equal(await tx.court.count(), 8)
      assert.equal(
        await tx.court.count({ where: { sport: CourtSport.TENNIS } }),
        2,
      )
      assert.equal(
        await tx.court.count({ where: { sport: CourtSport.PADEL } }),
        6,
      )
      assert.equal(await tx.booking.count(), 30)
      assert.equal(await tx.staff.count(), superAdmins.length + 18)
      for (const branch of branches) {
        assert.equal(
          await tx.booking.count({ where: { branchId: branch.id } }),
          15,
        )
        assert.equal(
          await tx.court.count({ where: { branchId: branch.id } }),
          4,
        )
      }
      const invalidHours = await tx.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM slots WHERE EXTRACT(HOUR FROM ("startAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')) NOT BETWEEN 6 AND 23 OR "endAt" - "startAt" <> interval '1 hour'`
      assert.equal(
        Number(invalidHours[0].count),
        0,
        'Invalid opening hours or slot duration',
      )
      const overlaps = await tx.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM booking_details d JOIN bookings b ON b.id=d."bookingId" WHERE b.status <> 'CANCELLED' AND d."slotId" IN (SELECT d2."slotId" FROM booking_details d2 JOIN bookings b2 ON b2.id=d2."bookingId" WHERE b2.status <> 'CANCELLED' GROUP BY d2."slotId" HAVING count(*) > 1)`
      assert.equal(
        Number(overlaps[0].count),
        0,
        'Overlapping active court bookings',
      )
      const wrongTotals = await tx.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM bookings b JOIN invoices i ON i."bookingId"=b.id JOIN payments p ON p.id=i."paymentId" WHERE b."totalPrice" <> i.total OR p.amount <> i.total`
      assert.equal(
        Number(wrongTotals[0].count),
        0,
        'Invoice/payment totals disagree',
      )
      return {
        customers: await tx.user.count(),
        courts: await tx.court.groupBy({
          by: ['branchId', 'sport'],
          _count: true,
        }),
        staff: await tx.staff.groupBy({
          by: ['branchId', 'role'],
          _count: true,
        }),
        bookings: await tx.booking.groupBy({
          by: ['branchId', 'status'],
          _count: true,
        }),
        slots: await tx.slot.count(),
        inventories: await tx.inventory.count(),
        memberships: await tx.membership.count(),
      }
    },
    { timeout: 180000, maxWait: 15000 },
  )
  const report = {
    generatedAt: clubTime().format(),
    backupFile,
    plan,
    verified: summary,
    dummyPassword: PASSWORD,
    employeeAccounts,
    customerAccounts: customers.map((name, index) => ({
      name,
      email: `customer${String(index + 1).padStart(2, '0')}@demo.quantum.test`,
    })),
    superAdmin: 'Existing credentials preserved, not included in this report.',
  }
  writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(
    JSON.stringify({ success: true, verified: summary, reportFile }, null, 2),
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
