import { Role } from '@prisma/client'
import { Context } from 'hono'
import type { PinoLogger } from 'hono-pino'

type UserTokenPayload = {
  id: string
  phone: string
}

type AdminTokenPayload = Omit<UserTokenPayload, 'phone'> & {
  role: Role
  email: string
  phone?: string
}

export type AppBinding = {}
export type AppVariables = {
  user: UserTokenPayload | null
  admin: AdminTokenPayload | null
  logger: PinoLogger
}

export type AppEnv = {
  Bindings: AppBinding
  Variables: AppVariables
}

export type AppContext<P extends string = string, S = any> = Context<
  AppEnv,
  P,
  S
>
export type AppRouteHandler<P extends string = string, S = any> = (
  c: AppContext<P, S>,
) => Promise<Response> | Response

export type DayToken =
  | number
  | 'Sunday'
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sun'
  | 'Mon'
  | 'Tue'
  | 'Wed'
  | 'Thu'
  | 'Fri'
  | 'Sat'
  | 'Minggu'
  | 'Senin'
  | 'Selasa'
  | 'Rabu'
  | 'Kamis'
  | 'Jumat'
  | 'Sabtu'
