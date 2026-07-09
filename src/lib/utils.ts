import dayjs from 'dayjs'
import { db } from './prisma'
import crypto from 'crypto'

export async function formatPhone(phone: string) {
  const cleaned = phone.replace(/[^\d+]/g, '')

  if (cleaned.startsWith('+62')) {
    return cleaned
  }

  if (cleaned.startsWith('62')) {
    return `+${cleaned}`
  }

  if (cleaned.startsWith('08')) {
    return `+62${cleaned.slice(1)}`
  }

  if (cleaned.startsWith('8')) {
    return `+62${cleaned}`
  }

  if (cleaned.startsWith('+')) {
    return cleaned
  }

  return `+${cleaned}`
}

export function formatPhoneForFazpass(phone: string) {
  return phone.replace(/^\+/, '')
}

export async function generateOtp(otpLength: number) {
  const min = Math.pow(10, otpLength - 1)
  const max = Math.pow(10, otpLength) - 1
  return (Math.floor(Math.random() * (max - min + 1)) + min).toString()
}

/**
 * Generate invoice number in format: INV-YYMMDD-XXXXXX
 * Example: INV-251116-A3K9FT
 */
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function randomCode(len = 6) {
  return Array.from({ length: len })
    .map(() => CHARSET[crypto.randomInt(0, CHARSET.length)])
    .join('')
}

export async function generateInvoiceNumber(maxAttempts = 5): Promise<string> {
  const now = new Date()
  const year = dayjs(now).format('YY')
  const month = dayjs(now).format('MM')
  const day = dayjs(now).format('DD')

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const number = `INV-${year}${month}${day}-${randomCode(6)}`

    const exist = await db.invoice.findUnique({
      where: { number },
      select: { id: true },
    })

    if (!exist) return number
  }

  throw new Error(
    'Unable to generate unique invoice number after several attempts',
  )
}
