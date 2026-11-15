import { strict as assert } from "node:assert"
import type { ArchitectureDiagram, ReviewMutation, ReviewState } from "@shared/architecture"
import { describe, it } from "mocha"
import { ARCHITECTURE_LIMITS as limits } from "./limits"
import { applyReviewMutation, validateReviewMutation, validateReviewState } from "./reviewValidation"

const identity = { taskId: "task-1", name: "tools", version: 2 }
const graph: ArchitectureDiagram = {
	title: "Tools",
	summary: "Keep boundaries explicit.",
	nodes: [{ id: "a", kind: "component", label: "A" }],
	edges: [{ id: "e", kind: "dependency", source: "a", target: "a" }],
}

function review(): ReviewState {
	return {
		comments: [
			{ id: "c1", target: { kind: "diagram" }, text: "General feedback", sent: false },
			{ id: "c2", target: { kind: "node", id: "a" }, text: "Node feedback", sent: false },
			{ id: "c3", target: { kind: "edge", id: "e" }, text: "Prior feedback", sent: true },
		],
		presentation: { positions: { a: { x: 10, y: -20 } }, viewport: { x: 0, y: 0, zoom: 1 } },
	}
}

describe("architecture review state validation", () => {
	it("accepts comments at all scopes and plain presentation without changing sent status", () => {
		const value = review()
		const result = validateReviewState(value, graph)
		assert.deepEqual(result, value)
		assert.notEqual(result, value)
		assert.deepEqual(validateReviewState({ comments: [] }, graph), { comments: [] })
	})

	it("rejects missing state, sent flags, malformed/extra fields and duplicate comment IDs", () => {
		const value = review()
		for (const invalid of [
			null,
			{},
			{ comments: [], version: 1 },
			{ comments: [{ id: "c1", target: { kind: "diagram" }, text: "x" }] },
			{ comments: [{ ...value.comments[0], sent: "false" }] },
			{ comments: [{ ...value.comments[0], accepted: true }] },
			{ comments: [{ ...value.comments[0], target: { kind: "diagram", id: "a" } }] },
			{ comments: [{ ...value.comments[0], target: { kind: "node" } }] },
			{ comments: [{ ...value.comments[0], target: { kind: "edge", id: "a", version: 2 } }] },
			{ comments: [value.comments[0], value.comments[0]] },
		])
			assert.throws(() => validateReviewState(invalid))
	})

	it("rejects unknown or wrong-kind targets and positions against the exact semantic version", () => {
		for (const target of [
			{ kind: "node", id: "missing" },
			{ kind: "node", id: "e" },
			{ kind: "edge", id: "a" },
		]) {
			assert.throws(() => validateReviewState({ comments: [{ ...review().comments[0], target }] }, graph), /Unknown/)
		}
		assert.throws(
			() => validateReviewState({ comments: [], presentation: { positions: { missing: { x: 0, y: 0 } } } }, graph),
			/Unknown node/,
		)
	})

	it("bounds comments and their text without truncation", () => {
		const comment = review().comments[0]
		const comments = Array.from({ length: limits.maxComments }, (_, index) => ({ ...comment, id: `c${index}` }))
		assert.equal(validateReviewState({ comments }).comments.length, limits.maxComments)
		assert.throws(() => validateReviewState({ comments: [...comments, { ...comment, id: "extra" }] }))
		assert.doesNotThrow(() => validateReviewState({ comments: [{ ...comment, text: "x".repeat(limits.maxCommentLength) }] }))
		for (const text of ["", " \n ", "x".repeat(limits.maxCommentLength + 1)]) {
			assert.throws(() => validateReviewState({ comments: [{ ...comment, text }] }))
		}
	})

	it("rejects aggregate review bytes even when each comment is individually valid", () => {
		const comments = Array.from({ length: 40 }, (_, index) => ({
			...review().comments[0],
			id: `c${index}`,
			text: "界".repeat(3_000),
		}))
		assert.throws(() => validateReviewState({ comments }), /UTF-8 bytes/)
	})

	it("requires finite bounded plain coordinates, bounded zoom and bounded positions", () => {
		const validate = (presentation: unknown) => validateReviewState({ comments: [], presentation })
		assert.doesNotThrow(() =>
			validate({
				positions: { a: { x: limits.maxCoordinateMagnitude, y: -limits.maxCoordinateMagnitude } },
				viewport: { x: 0, y: 0, zoom: limits.minZoom },
			}),
		)
		assert.doesNotThrow(() => validate({ positions: {}, viewport: { x: 0, y: 0, zoom: limits.maxZoom } }))
		for (const position of [
			{ x: Number.NaN, y: 0 },
			{ x: Number.POSITIVE_INFINITY, y: 0 },
			{ x: limits.maxCoordinateMagnitude + 1, y: 0 },
			{ x: 0 },
			{ x: 0, y: 0, selected: true },
		]) {
			assert.throws(() => validate({ positions: { a: position } }))
		}
		for (const zoom of [0, limits.minZoom / 2, limits.maxZoom + 1, Number.POSITIVE_INFINITY]) {
			assert.throws(() => validate({ positions: {}, viewport: { x: 0, y: 0, zoom } }))
		}
		assert.throws(() => validate({ positions: {}, edges: [] }))
		const positions = Object.fromEntries(
			Array.from({ length: limits.maxPositions }, (_, index) => [`n${index}`, { x: 0, y: 0 }]),
		)
		assert.doesNotThrow(() => validate({ positions }))
		assert.throws(() => validate({ positions: { ...positions, extra: { x: 0, y: 0 } } }))
	})

	it("rejects prototype-sensitive position keys instead of silently losing them", () => {
		for (const key of ["__proto__", "constructor", "prototype"]) {
			const value: unknown = JSON.parse(`{"comments":[],"presentation":{"positions":{"${key}":{"x":0,"y":0}}}}`)
			assert.throws(() => validateReviewState(value))
		}
	})
})

describe("architecture review mutation validation", () => {
	const mutations: ReviewMutation[] = [
		{
			identity,
			operation: "add_comment",
			comment: { id: "c1", target: { kind: "node", id: "a" }, text: "Keep this boundary" },
		},
		{ identity, operation: "edit_comment", commentId: "c1", text: "Clarify this boundary" },
		{ identity, operation: "delete_comment", commentId: "c1" },
		{ identity, operation: "save_presentation", presentation: { positions: { a: { x: 10, y: 20 } } } },
		{ identity, operation: "mark_sent", commentIds: ["c1", "c2"] },
	]
	for (const mutation of mutations) {
		it(`accepts ${mutation.operation} with exact ownership and rejects extra fields`, () => {
			assert.deepEqual(validateReviewMutation(mutation), mutation)
			assert.throws(() => validateReviewMutation({ ...mutation, replacementState: review() }))
			assert.throws(() => validateReviewMutation({ ...mutation, identity: { taskId: "task-1", name: "tools" } }))
			assert.throws(() => validateReviewMutation({ ...mutation, identity: { ...identity, mode: "latest" } }))
		})
	}

	it("does not allow new comments to self-declare sent or permit whole-state replacements", () => {
		assert.throws(() => validateReviewMutation({ identity, operation: "add_comment", comment: review().comments[0] }))
		assert.throws(() => validateReviewMutation({ identity, operation: "replace_review", review: review() }))
		assert.throws(() => validateReviewMutation({ identity, operation: "delete_comment", commentId: "c1", text: "unrelated" }))
	})

	it("rejects empty, duplicate and oversized sent batches", () => {
		for (const commentIds of [[], ["c1", "c1"], Array.from({ length: limits.maxComments + 1 }, (_, index) => `c${index}`)]) {
			assert.throws(() => validateReviewMutation({ identity, operation: "mark_sent", commentIds }))
		}
	})

	it("requires exact safe identity rather than latest/task/path substitution", () => {
		for (const invalidIdentity of [
			{ ...identity, taskId: "../other" },
			{ ...identity, name: "../tools" },
			{ ...identity, version: 0 },
			{ ...identity, version: "2" },
		]) {
			assert.throws(() => validateReviewMutation({ ...mutations[0], identity: invalidIdentity }))
		}
	})

	it("applies byte limits before validating malformed mutation payloads", () => {
		const positions = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`n${index}`, "界".repeat(3_000)]))
		assert.throws(
			() => validateReviewMutation({ identity, operation: "save_presentation", presentation: { positions } }),
			/UTF-8 bytes/,
		)
	})
})

describe("pure architecture review mutations", () => {
	it("applies add/edit/delete/presentation independently without mutating prior state", () => {
		const original = review()
		const snapshot = structuredClone(original)
		const added = applyReviewMutation(
			original,
			{
				identity,
				operation: "add_comment",
				comment: { id: "new", target: { kind: "diagram" }, text: "More feedback" },
			},
			graph,
		)
		assert.deepEqual(original, snapshot)
		assert.equal(added.comments.length, 4)
		assert.equal(added.comments[3].sent, false)
		assert.deepEqual(added.presentation, original.presentation)
		const edited = applyReviewMutation(
			added,
			{ identity, operation: "edit_comment", commentId: "new", text: "Changed" },
			graph,
		)
		assert.equal(edited.comments[3].text, "Changed")
		assert.equal(added.comments[3].text, "More feedback")
		const positioned = applyReviewMutation(
			edited,
			{ identity, operation: "save_presentation", presentation: { positions: { a: { x: 50, y: 60 } } } },
			graph,
		)
		assert.deepEqual(positioned.comments, edited.comments)
		assert.deepEqual(edited.presentation, original.presentation)
		const deleted = applyReviewMutation(positioned, { identity, operation: "delete_comment", commentId: "new" }, graph)
		assert.deepEqual(deleted.comments, original.comments)
		assert.deepEqual(deleted.presentation, positioned.presentation)
	})

	it("marks only included comments sent and is idempotent for persisted-delivery reconciliation", () => {
		const original = review()
		const mutation: ReviewMutation = { identity, operation: "mark_sent", commentIds: ["c2", "c3"] }
		const sent = applyReviewMutation(original, mutation, graph)
		assert.deepEqual(
			sent.comments.map((comment) => comment.sent),
			[false, true, true],
		)
		assert.deepEqual(applyReviewMutation(sent, mutation, graph), sent)
		assert.equal(original.comments[1].sent, false)
	})

	it("rejects edits/deletions of sent comments and edits of unknown comment IDs", () => {
		for (const commentId of ["c3", "missing"]) {
			assert.throws(() =>
				applyReviewMutation(review(), { identity, operation: "edit_comment", commentId, text: "Change" }, graph),
			)
			if (commentId === "c3")
				assert.throws(() => applyReviewMutation(review(), { identity, operation: "delete_comment", commentId }, graph))
		}
		const original = review()
		assert.throws(
			() => applyReviewMutation(original, { identity, operation: "mark_sent", commentIds: ["c1", "missing"] }, graph),
			/Unknown comment/,
		)
		assert.equal(original.comments[0].sent, false)
	})

	it("rejects duplicates, missing targets and positions without changing the input", () => {
		const original = review()
		const mutations: ReviewMutation[] = [
			{ identity, operation: "add_comment", comment: { id: "c1", target: { kind: "diagram" }, text: "Duplicate" } },
			{
				identity,
				operation: "add_comment",
				comment: { id: "new", target: { kind: "node", id: "missing" }, text: "Target" },
			},
			{ identity, operation: "save_presentation", presentation: { positions: { missing: { x: 0, y: 0 } } } },
		]
		for (const mutation of mutations) {
			assert.throws(() => applyReviewMutation(original, mutation, graph))
			assert.deepEqual(original, review())
		}
	})

	it("cannot exceed the comment count or serialized review limit through valid individual mutations", () => {
		const full: ReviewState = {
			comments: Array.from({ length: limits.maxComments }, (_, index) => ({
				id: `c${index}`,
				target: { kind: "diagram" },
				text: "x",
				sent: false,
			})),
		}
		assert.throws(() =>
			applyReviewMutation(
				full,
				{ identity, operation: "add_comment", comment: { id: "extra", target: { kind: "diagram" }, text: "More" } },
				graph,
			),
		)
		const large: ReviewState = { comments: [] }
		let state = large
		let rejected = false
		for (let index = 0; index < 40; index++) {
			const mutation: ReviewMutation = {
				identity,
				operation: "add_comment",
				comment: { id: `c${index}`, target: { kind: "diagram" }, text: "x".repeat(limits.maxCommentLength) },
			}
			try {
				state = applyReviewMutation(state, mutation, graph)
			} catch (error) {
				assert.match(String(error), /UTF-8 bytes/)
				rejected = true
				break
			}
		}
		assert.equal(rejected, true)
		assert.deepEqual(large, { comments: [] })
		assert.doesNotThrow(() => validateReviewState(state, graph))
	})
})
