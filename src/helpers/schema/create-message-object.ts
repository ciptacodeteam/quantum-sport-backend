import { z } from '@hono/zod-openapi'

const createMessageObjectSchema = (
  exampleMessage: string = 'Hello World',
  data?: Record<string, any> | Array<any> | string | number | boolean | null,
  errors?: string,
) => {
  return z
    .object({
      status: z.boolean().optional(),
      msg: z.string(),
      data: z.any().optional(),
      errors: z.any().optional(),
    })
    .openapi({
      example: {
        status: true,
        msg: exampleMessage,
        data: data || undefined,
        errors: errors || undefined,
      },
    })
}

export default createMessageObjectSchema
