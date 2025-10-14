import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin, openAPI, phoneNumber } from 'better-auth/plugins'
import { db } from './prisma'
import { log } from './logger'
import { sendPhoneOtp } from '@/services/phone-service'
import { formatPhone } from './utils'
import dayjs from 'dayjs'

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  plugins: [
    admin(),
    openAPI(),
    phoneNumber({
      sendOTP: async ({ phoneNumber, code }) => {
        // Implement sending OTP code via SMS
        log.info(`Sending OTP ${code} to phone number ${phoneNumber}`)

        const otpId = await sendPhoneOtp(phoneNumber, code)

        if (!otpId) {
          throw new Error('Failed to send OTP')
        }

        await db.phoneVerification.create({
          data: {
            requestId: otpId,
            phone: await formatPhone(phoneNumber),
            code,
            expiresAt: dayjs().add(5, 'minute').toDate(),
          },
        })
      },
      otpLength: 4,
      expiresIn: 5 * 60, // 5 minutes
    }),
  ],
  advanced: {
    defaultCookieAttributes: {
      sameSite: 'lax', // CSRF protection
      httpOnly: true, // Prevent client-side JS access
      secure: true,
      partitioned: true, // New browser standards will mandate this for foreign cookies
    },
  },
})
