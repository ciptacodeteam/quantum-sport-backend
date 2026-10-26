import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'

const db = new PrismaClient()
try {
  const [result] = await db.$queryRaw<
    { name: string | null }[]
  >`SELECT to_regclass('public.branches')::text AS name`
  if (!result.name) {
    const sql = await readFile(
      new URL('./branches.sql', import.meta.url),
      'utf8',
    )
    const statements = sql
      .split(';')
      .map((part) => part.replace(/--[^\n]*/g, '').trim())
      .filter((part) => part && !['BEGIN', 'COMMIT'].includes(part))
    await db.$transaction(
      async (tx) => {
        for (const statement of statements)
          await tx.$executeRawUnsafe(statement)
      },
      { timeout: 120000 },
    )
    console.info(
      'Cabang Cemara dan S. Parman dibuat. Semua data lama berada di Cemara. Saldo membership tetap bersama.',
    )
  } else {
    console.info('Struktur cabang sudah tersedia; migrasi tidak diulang.')
  }
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
    await db.staff.update({
      where: { id: staff.id },
      data: { role: 'SUPER_ADMIN', email },
    })
    await db.authToken.deleteMany({ where: { staffId: staff.id } })
    console.info('Akun terpilih menjadi SUPER_ADMIN. Silakan login kembali.')
  } else {
    console.info(
      'Untuk menetapkan super admin: bun prisma/setup-branches.ts --super-admin-email=EMAIL_ADMIN',
    )
  }
} finally {
  await db.$disconnect()
}
