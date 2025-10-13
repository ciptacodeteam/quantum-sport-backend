type ResponseSuccess<T> = {
  success: boolean
  msg: string
  data?: T
}

type ResponseError = {
  success: boolean
  msg: string
  code: string
  details?: unknown
}

export function ok<T>(data: T, msg = 'Success'): ResponseSuccess<T> {
  let res: ResponseSuccess<T> = {
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
  code = 'ERR_BAD_REQUEST',
  details?: unknown,
): ResponseError {
  return {
    success: false,
    msg,
    code,
    ...(details !== undefined && { details }),
  }
}
