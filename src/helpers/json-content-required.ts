import jsonContent from './json-content'
import type { ZodSchema } from './types'

const jsonContentRequired = <T extends ZodSchema>(
  schema: T,
  description: string,
) => {
  return {
    ...jsonContent(schema, description),
    required: true,
  }
}

export default jsonContentRequired
