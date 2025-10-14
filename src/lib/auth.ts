import { DEFAULT_OTP_CODE } from '@/constants'
import { env } from '@/env'
import { sendPhoneOtp } from '@/services/phone-service'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin, openAPI, phoneNumber } from 'better-auth/plugins'
import dayjs from 'dayjs'
import { log } from './logger'
import { db } from './prisma'
import { formatPhone } from './utils'

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  plugins: [
    admin(),
    openAPI(),
    phoneNumber({
      sendOTP: async ({ phoneNumber, code }) => {
        // Implement sending OTP code via SMS
        log.info(`Sending OTP ${code} to phone number ${phoneNumber}`)

        const phone = await formatPhone(phoneNumber)
        let defaultCode = DEFAULT_OTP_CODE
        let requestId = Math.random().toString(36).substring(2, 15)

        if (env.nodeEnv === 'production') {
          requestId = await sendPhoneOtp(phone, code)

          if (!requestId) {
            throw new Error('Failed to send OTP')
          }
          defaultCode = code
        }

        await db.phoneVerification.create({
          data: {
            requestId,
            phone: await formatPhone(phone),
            code: defaultCode,
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
