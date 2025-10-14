import { StatusCode } from 'hono/utils/http-status'
import status from 'http-status'

type ResponseSuccess<T> = {
  success: number | true
  msg: string
  data?: T | null
}

type ResponseError = {
  success: number | false
  msg: string
  code: StatusCode
  errors?: unknown
}

export function ok<T>(data: T, msg = 'Success'): ResponseSuccess<T> {
  let res: ResponseSuccess<T> = {
    success: true,
    msg,
    data: null,
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
