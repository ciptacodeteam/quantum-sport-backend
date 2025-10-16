import { HTTPException } from 'hono/http-exception'

export const timeoutException = (c) =>
  new HTTPException(408, {
    message: `Request timeout after waiting ${c.req.headers.get(
      'Duration',
    )} seconds. Please try again later.`,
  })

export class NotFoundException extends HTTPException {
  constructor(msg?: string) {
    super(404, {
      message: msg || `Resource not found. Please check the URL and try again.`,
    })
  }
}

export class UnauthorizedException extends HTTPException {
  constructor() {
    super(401, {
      message: 'Unauthorized access. Please provide valid credentials.',
    })
  }
}

export class ForbiddenException extends HTTPException {
  constructor() {
    super(403, {
      message: 'Forbidden. You do not have permission to access this resource.',
    })
  }
}

export class BadRequestException extends HTTPException {
  constructor(details?: string) {
    super(400, {
      message: `Bad request. ${details || 'Invalid input.'}`,
    })
  }
}
