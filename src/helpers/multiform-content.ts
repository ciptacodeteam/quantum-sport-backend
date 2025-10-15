import { ZodSchema } from './types'

const multiformContent = <T extends ZodSchema>(
  schema: T,
  description: string,
) => {
  return {
    content: {
      'multipart/form-data': {
        schema,
      },
    },
    description,
  }
}

export default multiformContent
