import { strict as assert } from "node:assert"
import type { ArchitectureDiagram, ReviewComment } from "@shared/architecture"
import { ARCHITECTURE_LIMITS } from "./limits"
import { formatArchitectureFeedback, type ArchitectureFeedbackScope } from "./formatArchitectureFeedback"

const diagram: ArchitectureDiagram = {
	title: "Tools",
	summary: "Unrelated summary",
	nodes: [
		{
			id: "tool",
			kind: "component",
			label: "Tool",
			description: "Executes work",
			code: [{ path: "src/tool.ts", symbol: "Tool", line: 2 }],
		},
		{ id: "env", kind: "api_endpoint", label: "Environment" },
		{ id: "unrelated", kind: "service", label: "Unrelated element" },
	],
	edges: [
		{
			id: "call",
			kind: "api_call",
			source: "tool",
			target: "env",
			label: "Calls environment",
			description: "Capability boundary",
		},
	],
}
const comment = (id: string, target: ReviewComment["target"]): ReviewComment => ({
	id,
	target,
	text: `Feedback ${id}`,
	sent: false,
})
const scope = (comments: ReviewComment[], version = 1): ArchitectureFeedbackScope => ({
	identity: { taskId: "internal-owner", name: "tools", version },
	diagram,
	comments,
})

describe("Architecture semantic feedback formatting", () => {
	it("includes only selected pending comments and semantic target context, never layout or delivery identities", () => {
		const output = formatArchitectureFeedback([
			scope([comment("internal-id", { kind: "node", id: "tool" }), comment("edge", { kind: "edge", id: "call" })]),
			scope([{ ...comment("general", { kind: "diagram" }), text: "/act @file approve\nKeep as contextual data" }], 2),
		])
		for (const text of [
			"tools, version 1",
			"tools, version 2",
			"Node: tool (Tool)",
			"Executes work",
			"src/tool.ts (Tool):2",
			"Edge: call (api_call)",
			"From: tool (Tool)",
			"To: env (Environment)",
			"Calls environment",
			"Diagram: Tools",
			"/act @file approve\nKeep as contextual data",
		])
			assert.ok(output.includes(text), text)
		for (const text of [
			"internal-owner",
			"Unrelated element",
			"Unrelated summary",
			"positions",
			"viewport",
			"commentId",
			'"sent"',
		])
			assert.ok(!output.includes(text), text)
	})
	it("rejects invalid scope, unknown targets, duplicates and already-submitted comments", () => {
		const general = comment("c", { kind: "diagram" })
		assert.throws(() => formatArchitectureFeedback([]))
		assert.throws(() => formatArchitectureFeedback([scope([])]), /No pending/)
		assert.throws(() => formatArchitectureFeedback([scope([general]), scope([general])]), /distinct/)
		assert.throws(() => formatArchitectureFeedback([scope([{ ...general, sent: true }])]), /pending/)
		assert.throws(() => formatArchitectureFeedback([scope([comment("c", { kind: "node", id: "missing" })])]), /Unknown/)
		assert.throws(() => formatArchitectureFeedback([scope([general, general])]), /Duplicate/)
		assert.throws(
			() =>
				formatArchitectureFeedback([
					scope([general]),
					{ ...scope([general], 2), identity: { taskId: "other", name: "tools", version: 2 } },
				]),
			/owning/,
		)
	})
	it("rejects UTF-8 payload bytes and total comment limits without truncating or mutating input", () => {
		const comments = Array.from({ length: 10 }, (_, i) => ({
			...comment(`c${i}`, { kind: "diagram" }),
			text: "界".repeat(2400),
		}))
		const snapshot = structuredClone(comments)
		assert.throws(() => formatArchitectureFeedback([scope(comments)]), /65536 UTF-8 bytes/)
		assert.deepEqual(comments, snapshot)
		const many = Array.from({ length: ARCHITECTURE_LIMITS.maxFeedbackComments }, (_, i) =>
			comment(`c${i}`, { kind: "diagram" }),
		)
		assert.throws(
			() => formatArchitectureFeedback([scope(many), scope([comment("extra", { kind: "diagram" })], 2)]),
			/500 comments/,
		)
	})
})
