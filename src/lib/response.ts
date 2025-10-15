import { StatusCode } from 'hono/utils/http-status'
import status from 'http-status'

type ResponseError = {
  success: number | false
  msg: string
  code: StatusCode
  errors?: unknown
}

export function ok(data: any, msg = 'Success') {
  let res: any = {
    success: true,
    msg,
  }

  if (data) {
    res = { ...res, data }
  }

  return res
}

export function err(
  msg: string,
  code: StatusCode = status.INTERNAL_SERVER_ERROR,
  errors?: unknown,
): ResponseError {
  return {
    success: false,
    code,
    msg,
    ...(errors !== undefined && { errors }),
  }
}
