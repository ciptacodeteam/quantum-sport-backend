import { Hook } from '@hono/zod-validator'
import status from 'http-status'

export const validateHook: Hook<any, any, any> = (result, c) => {
  if (!result.success) {
    return c.json(
      {
        success: result.success,
        message: 'Validation Error',
        error: {
          name: result.error.name,
          issues: result.error.issues,
        },
      },
      status.UNPROCESSABLE_ENTITY,
    )
  }
}
