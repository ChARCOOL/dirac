import type { ArchitectureDiagram, ReviewMutation, ReviewState, ReviewTarget } from "@shared/architecture"
import { z } from "zod"
import { ARCHITECTURE_LIMITS as limits } from "./limits"
import {
	assertBoundedArchitectureValue,
	entityIdSchema,
	nonblankString,
	rejectArchitectureValue,
	resolvedIdentitySchema,
} from "./validationPrimitives"

const targetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("diagram") }).strict(),
	z.object({ kind: z.literal("node"), id: entityIdSchema }).strict(),
	z.object({ kind: z.literal("edge"), id: entityIdSchema }).strict(),
])
const pendingCommentFields = {
	id: entityIdSchema,
	target: targetSchema,
	text: nonblankString(limits.maxCommentLength),
}
const commentSchema = z.object({ ...pendingCommentFields, sent: z.boolean() }).strict()
const coordinateSchema = z.number().finite().min(-limits.maxCoordinateMagnitude).max(limits.maxCoordinateMagnitude)
const positionSchema = z.object({ x: coordinateSchema, y: coordinateSchema }).strict()
const presentationSchema = z
	.object({
		positions: z
			.record(entityIdSchema, positionSchema)
			.refine(
				(positions) => Object.keys(positions).length <= limits.maxPositions,
				`At most ${limits.maxPositions} positions`,
			),
		viewport: z
			.object({
				x: coordinateSchema,
				y: coordinateSchema,
				zoom: z.number().finite().min(limits.minZoom).max(limits.maxZoom),
			})
			.strict()
			.optional(),
	})
	.strict()
const reviewSchema = z
	.object({ comments: z.array(commentSchema).max(limits.maxComments), presentation: presentationSchema.optional() })
	.strict()

/** Pass the already-validated semantic graph on reads/writes to also check target and position ownership. */
export function validateReviewState(value: unknown, diagram?: ArchitectureDiagram): ReviewState {
	assertBoundedArchitectureValue(value, limits.maxReviewBytes)
	const state = reviewSchema.parse(value)
	const ids = new Set<string>()
	for (const [index, comment] of state.comments.entries()) {
		if (ids.has(comment.id)) rejectArchitectureValue(["comments", index, "id"], `Duplicate comment ID '${comment.id}'`)
		ids.add(comment.id)
	}
	if (diagram) validateReviewReferences(state, diagram)
	return state
}

function validateReviewReferences(state: ReviewState, diagram: ArchitectureDiagram): void {
	const nodes = new Set(diagram.nodes.map((node) => node.id))
	const edges = new Set(diagram.edges.map((edge) => edge.id))
	for (const [index, comment] of state.comments.entries()) {
		const target: ReviewTarget = comment.target
		if (target.kind === "diagram") continue
		if (!(target.kind === "node" ? nodes : edges).has(target.id)) {
			rejectArchitectureValue(["comments", index, "target", "id"], `Unknown ${target.kind} '${target.id}'`)
		}
	}
	for (const id of Object.keys(state.presentation?.positions ?? {})) {
		if (!nodes.has(id)) rejectArchitectureValue(["presentation", "positions", id], `Unknown node '${id}'`)
	}
}

const mutationSchema = z.discriminatedUnion("operation", [
	z
		.object({
			identity: resolvedIdentitySchema,
			operation: z.literal("add_comment"),
			comment: z.object(pendingCommentFields).strict(),
		})
		.strict(),
	z
		.object({
			identity: resolvedIdentitySchema,
			operation: z.literal("edit_comment"),
			commentId: entityIdSchema,
			text: pendingCommentFields.text,
		})
		.strict(),
	z.object({ identity: resolvedIdentitySchema, operation: z.literal("delete_comment"), commentId: entityIdSchema }).strict(),
	z
		.object({ identity: resolvedIdentitySchema, operation: z.literal("save_presentation"), presentation: presentationSchema })
		.strict(),
	z
		.object({
			identity: resolvedIdentitySchema,
			operation: z.literal("mark_sent"),
			commentIds: z
				.array(entityIdSchema)
				.min(1)
				.max(limits.maxComments)
				.refine((ids) => new Set(ids).size === ids.length, "Comment IDs must be unique"),
		})
		.strict(),
])

/** Shape/identity only; storage enforces existing targets, pending-only edits and persistence acknowledgement. */
export function validateReviewMutation(value: unknown): ReviewMutation {
	assertBoundedArchitectureValue(value, limits.maxReviewMutationBytes)
	return mutationSchema.parse(value)
}

/**
 * Pure sidecar update. Storage must match mutation.identity to its owning task/name/version and serialize writes.
 * mark_sent is an internal acknowledgement after durable conversation persistence, not panel authorization.
 */
export function applyReviewMutation(review: ReviewState, mutation: ReviewMutation, diagram: ArchitectureDiagram): ReviewState {
	const state = validateReviewState(review, diagram)
	const change = validateReviewMutation(mutation)
	if (change.operation === "edit_comment" || change.operation === "delete_comment") {
		const comment = state.comments.find((comment) => comment.id === change.commentId)
		// A lost acknowledgement can be retried without duplicating or resurrecting a saved deletion.
		if (!comment && change.operation === "delete_comment") return state
		if (!comment) rejectArchitectureValue(["commentId"], `Unknown comment '${change.commentId}'`)
		if (comment.sent)
			rejectArchitectureValue(["commentId"], "Sent comments cannot be edited or deleted; add a correction instead")
		if (change.operation === "edit_comment") comment.text = change.text
		else state.comments = state.comments.filter((comment) => comment.id !== change.commentId)
		return validateReviewState(state, diagram)
	}

	switch (change.operation) {
		case "add_comment": {
			const existing = state.comments.find((comment) => comment.id === change.comment.id)
			if (existing) {
				if (
					existing.text === change.comment.text &&
					JSON.stringify(existing.target) === JSON.stringify(change.comment.target)
				)
					return state
				rejectArchitectureValue(
					["comment", "id"],
					`Duplicate comment ID '${change.comment.id}' with different content; refresh before editing`,
				)
			}
			state.comments.push({ ...change.comment, sent: false })
			break
		}
		case "save_presentation":
			state.presentation = change.presentation
			break
		case "mark_sent": {
			const comments = new Map(state.comments.map((comment) => [comment.id, comment]))
			for (const [index, id] of change.commentIds.entries()) {
				const comment = comments.get(id)
				if (!comment) rejectArchitectureValue(["commentIds", index], `Unknown comment '${id}'`)
				comment.sent = true
			}
			break
		}
	}
	return validateReviewState(state, diagram)
}
