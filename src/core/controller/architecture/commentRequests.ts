import { z } from "zod"
import type { CommentMutation } from "@shared/architecture"
import { ARCHITECTURE_LIMITS } from "@core/architecture/limits"
import { assertArchitectureJsonBytes, resolvedIdentitySchema } from "@core/architecture/validationPrimitives"
import { validateReviewMutation } from "@core/architecture/reviewValidation"

const requestSchema = resolvedIdentitySchema.extend({ mutationJson: z.string() }).strict()

/** Panel input can never supply a sent indicator, presentation replacement or delivery acknowledgement. */
export function parseCommentRequest(input: unknown): CommentMutation {
	const { mutationJson, ...identity } = requestSchema.parse(input)
	assertArchitectureJsonBytes(mutationJson, ARCHITECTURE_LIMITS.maxReviewMutationBytes)
	const change: unknown = JSON.parse(mutationJson)
	if (!change || typeof change !== "object" || Array.isArray(change) || "identity" in change)
		throw new Error("Invalid comment mutation")
	const mutation = validateReviewMutation({ ...change, identity })
	if (mutation.operation === "save_presentation" || mutation.operation === "mark_sent")
		throw new Error("This endpoint only adds, edits or deletes pending comments")
	return mutation
}
