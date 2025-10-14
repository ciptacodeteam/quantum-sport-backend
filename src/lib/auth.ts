import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin, openAPI } from 'better-auth/plugins'
import { db } from './prisma'

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  plugins: [admin(), openAPI()],
  advanced: {
    defaultCookieAttributes: {
      sameSite: 'lax', // CSRF protection
      httpOnly: true, // Prevent client-side JS access
      secure: true,
      partitioned: true, // New browser standards will mandate this for foreign cookies
    },
  },
})
