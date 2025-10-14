import { handle } from 'hono/vercel'

import app from '../src/app'

const handler = handle(app as any)

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const PATCH = handler
