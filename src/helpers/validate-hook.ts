import { Hook } from '@hono/zod-validator'
import status from 'http-status'
import { ZodError } from 'zod'

export function zodErrorToFormErrors(
  err: ZodError<any> | { issues?: any[] } | undefined,
): Record<string, string> {
  const formErrors: Partial<Record<string, string>> = {}
  if (err?.issues && Array.isArray(err.issues)) {
    err.issues.forEach((issue: any) => {
      const path =
        Array.isArray(issue.path) && issue.path.length
          ? String(issue.path[0])
          : undefined
      const message = issue.message ?? JSON.stringify(issue)
      if (path) {
        formErrors[path] = message
      }
    })
  }
  return formErrors as Record<string, string>
}

export const validateHook: Hook<any, any, any> = (result, c) => {
  if (!result.success) {
    const fieldErrors = zodErrorToFormErrors(result.error)

    return c.json(
      {
        code: status.UNPROCESSABLE_ENTITY,
        success: result.success,
        message: 'Validation Error',
        errors: {
          name: result.error.name,
          fields: fieldErrors,
        },
      },
      status.UNPROCESSABLE_ENTITY,
    )
  }
}
