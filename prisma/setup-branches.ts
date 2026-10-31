import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'

const preserved = [
  'user',
  'staff',
  'courts',
  'inventories',
  'bookings',
  'invoices',
  'slots',
  'memberships',
  'membership_users',
  'banners',
  'court_cost_schedules',
  'notifications',
  'classes',
  'class_bookings',
  'tournaments',
  'partnerships',
  'promo_codes',
] as const

export function assertNotFewer(
  before: Record<string, number>,
  after: Record<string, number>,
) {
  for (const [table, count] of Object.entries(before)) {
    if (after[table] < count)
      throw new Error(
        `Migrasi dibatalkan: ${table} berkurang dari ${count} menjadi ${after[table]}`,
      )
  }
}

if (process.argv.includes('--self-check')) {
  assertNotFewer({ bookings: 2 }, { bookings: 2 })
  assertNotFewer({ bookings: 2 }, { bookings: 3 })
  let rejected = false
  try {
    assertNotFewer({ bookings: 2 }, { bookings: 1 })
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('penurunan jumlah baris harus membatalkan migrasi')
  console.info('ok')
  process.exit(0)
}

async function counts(query: {
  $queryRawUnsafe: (sql: string) => Promise<{ n: number }[]>
}) {
  const totals: Record<string, number> = {}
  for (const table of preserved) {
    const [row] = await query.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${table}"`,
    )
    totals[table] = Number(row.n)
  }
  return totals
}

const apply = process.argv.includes('--apply')
const db = new PrismaClient()
try {
  const before = await counts(db)
  const [existing] = await db.$queryRaw<{ name: string | null }[]>`
    SELECT to_regclass('public.branches')::text AS name
  `
  const admins = await db.$queryRaw<{ email: string; role: string }[]>`
    SELECT email, role::text AS role
    FROM staff
    WHERE "isActive" = true AND role::text IN ('ADMIN', 'SUPER_ADMIN')
    ORDER BY email
  `
  console.info(
    JSON.stringify({
      apply,
      branchesReady: Boolean(existing.name),
      preserved: before,
      activeAdmins: admins,
    }),
  )
  if (!apply) {
    console.info(
      'Pratinjau saja. Ulangi dengan --apply untuk memasang cabang. Tidak ada baris yang diubah.',
    )
  } else if (!existing.name) {
    const sql = await readFile(new URL('./branches.sql', import.meta.url), 'utf8')
    const statements = sql
      .split(';')
      .map((part) => part.replace(/--[^\n]*/g, '').trim())
      .filter((part) => part && !['BEGIN', 'COMMIT'].includes(part))
    await db.$transaction(
      async (tx) => {
        const starting = await counts(tx)
        for (const statement of statements) await tx.$executeRawUnsafe(statement)
        assertNotFewer(starting, await counts(tx))
        const stamped = [
          'bookings',
          'courts',
          'invoices',
          'slots',
          'staff',
          'inventories',
          'court_cost_schedules',
          'notifications',
          'partnerships',
          'promo_codes',
          'classes',
          'class_bookings',
          'tournaments',
          'banners',
        ]
        let stray = 0
        for (const table of stamped) {
          const [row] = await tx.$queryRawUnsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM "${table}" WHERE "branchId" <> 'cemara'`,
          )
          stray += Number(row.n)
        }
        const [check] = await tx.$queryRaw<{ cemara: boolean; sparman: boolean }[]>`
          SELECT
            (SELECT "isActive" FROM branches WHERE id = 'cemara') AS cemara,
            (SELECT "isActive" FROM branches WHERE id = 's-parman') AS sparman
        `
        if (stray !== 0)
          throw new Error('Migrasi dibatalkan: ada data lama yang tidak berada di Cemara.')
        if (check.cemara !== true || check.sparman !== false)
          throw new Error('Migrasi dibatalkan: Cemara harus aktif dan S. Parman harus nonaktif.')
      },
      { timeout: 600000 },
    )
    console.info(
      'Data lama tetap di Cemara. S. Parman dibuat nonaktif. Tidak ada baris operasional yang dihapus.',
    )
  } else {
    console.info('Struktur cabang sudah ada. SQL cabang tidak diulang dan data lama tidak ditulis ulang.')
  }
  if (apply) {
    await db.$executeRawUnsafe(
      await readFile(new URL('./global-banners.sql', import.meta.url), 'utf8'),
    )
    const email = process.argv
      .find((arg) => arg.startsWith('--super-admin-email='))
      ?.slice('--super-admin-email='.length)
    if (email) {
      const previousEmail = process.argv
        .find((arg) => arg.startsWith('--from-admin-email='))
        ?.slice('--from-admin-email='.length)
      let staff = await db.staff.findUnique({
        where: { email: previousEmail || email },
        select: { id: true, role: true, isActive: true },
      })
      if (!staff && previousEmail)
        staff = await db.staff.findUnique({
          where: { email },
          select: { id: true, role: true, isActive: true },
        })
      if (!staff?.isActive || !['ADMIN', 'SUPER_ADMIN'].includes(staff.role))
        throw new Error('Pilih email akun admin aktif yang sudah ada.')
      if (previousEmail && previousEmail !== email)
        throw new Error('Email admin tidak diubah. Pakai email akun yang sudah ada.')
      await db.staff.update({
        where: { id: staff.id },
        data: { role: 'SUPER_ADMIN' },
      })
      await db.authToken.deleteMany({ where: { staffId: staff.id } })
      console.info('Peran akun menjadi SUPER_ADMIN. Email dan password tidak diubah. Silakan login kembali.')
    }
  }
} finally {
  await db.$disconnect()
}
