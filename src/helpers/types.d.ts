import type { z } from '@hono/zod-openapi'

export type ZodSchema = z.ZodUnion | z.AnyZodObject | z.ZodArray<z.AnyZodObject>
export type ZodIssue = z.ZodIssue
