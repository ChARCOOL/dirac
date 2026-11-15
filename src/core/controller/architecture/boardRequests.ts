import { z } from "zod"
import { ARCHITECTURE_LIMITS } from "@core/architecture/limits"
import { assertArchitectureJsonBytes, resolvedIdentitySchema, entityIdSchema } from "@core/architecture/validationPrimitives"
import { validateReviewMutation } from "@core/architecture/reviewValidation"

const presentationRequest = resolvedIdentitySchema.extend({ presentationJson: z.string() }).strict()
export function parsePresentationRequest(input: unknown) {
	const { presentationJson, ...identity } = presentationRequest.parse(input)
	assertArchitectureJsonBytes(presentationJson, ARCHITECTURE_LIMITS.maxReviewMutationBytes)
	return validateReviewMutation({ identity, operation: "save_presentation", presentation: JSON.parse(presentationJson) })
}

export const codeRequestSchema = resolvedIdentitySchema
	.extend({
		targetKind: z.enum(["node", "edge"]),
		targetId: entityIdSchema,
		referenceIndex: z
			.number()
			.int()
			.min(0)
			.max(ARCHITECTURE_LIMITS.maxCodeReferencesPerElement - 1),
	})
	.strict()
