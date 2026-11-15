import { z } from "zod"
import { diagramVersionSchema, resolvedIdentitySchema } from "@core/architecture/validationPrimitives"

export const feedbackRequestSchema = resolvedIdentitySchema
	.omit({ version: true })
	.extend({ versions: z.array(diagramVersionSchema).min(1).max(2) })
	.strict()
