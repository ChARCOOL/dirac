import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sinon from "sinon"
import type { ArchitecturePanelOptions } from "@shared/architecture/panel"
import type { ExtensionMessage } from "@shared/ExtensionMessage"
import { ArchitectureStorage } from "@core/architecture/ArchitectureStorage"
import { invalidateArchitectureTask } from "@core/architecture/architectureOperations"
import { setHostCapabilities } from "@hosts/host-capabilities"
import { ArchitectureBoardController } from "./ArchitectureBoardController"

const identity = { taskId: "owner", name: "tools", version: 1 }
const graph = {
	title: "Tools",
	summary: "Review",
	nodes: [{ id: "a", kind: "component", label: "A" }],
	edges: [{ id: "e", kind: "dependency", source: "a", target: "a" }],
}
const add = (id = "c", target: object = { kind: "diagram" }) => ({
	operation: "add_comment",
	comment: { id, target, text: `Feedback ${id}` },
})

describe("Architecture local comments", () => {
	let root: string
	let storage: ArchitectureStorage
	let boards: ArchitectureBoardController
	let panel: ArchitecturePanelOptions
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "board-comments-"))
		storage = new ArchitectureStorage("owner", root)
		await storage.upsertDiagram("tools", JSON.stringify(graph))
		setHostCapabilities({
			architectureViewer: {
				prepare: async () => {},
				createPanel: async (options) => {
					panel = options
					return { reveal() {}, dispose() {}, refresh: async () => {} }
				},
			},
		})
		boards = new ArchitectureBoardController(
			(id) => {
				if (id !== "owner") throw new Error("Wrong owner")
			},
			() => root,
		)
		await boards.open({ taskId: identity.taskId, name: identity.name, mode: "latest" })
		await boards.read({ taskId: "owner", viewLatest: false })
	})
	afterEach(async () => {
		sinon.restore()
		boards.dispose()
		setHostCapabilities(undefined)
		await fs.rm(root, { recursive: true, force: true })
	})
	const request = (mutation: object, version = 1) => ({ ...identity, version, mutationJson: JSON.stringify(mutation) })
	it("persists all comment targets concurrently with layout, without invoking conversation input or publishing", async () => {
		// The only supplied capabilities are storage paths and the viewer; any chat RPC is rejected below.
		await Promise.all([
			...[add("general"), add("node", { kind: "node", id: "a" }), add("edge", { kind: "edge", id: "e" })].map((change) =>
				boards.mutateComment(request(change)),
			),
			boards.savePresentation({ ...identity, presentationJson: JSON.stringify({ positions: { a: { x: 1, y: 2 } } }) }),
		])
		await boards.mutateComment(request({ operation: "edit_comment", commentId: "node", text: "Edited" }))
		await boards.mutateComment(request({ operation: "delete_comment", commentId: "edge" }))
		panel.onDispose()
		await boards.open({ ...identity, mode: "exact" })
		const pane = (await boards.read({ taskId: "owner", viewLatest: false })).panes[0]
		assert.deepEqual(
			JSON.parse(pane.commentsJson!).map((comment: { text: string }) => comment.text),
			["Feedback general", "Edited"],
		)
		assert.deepEqual(JSON.parse(pane.presentationJson!), { positions: { a: { x: 1, y: 2 } } })
		assert.deepEqual(await storage.listDiagrams(), [{ name: "tools", versions: [1] }])
		assert.deepEqual((await storage.fetchDiagram("tools")).diagram, graph)
	})
	it("keeps exact comparison identities, finds older pending comments and navigates without switching a conversation", async () => {
		await boards.mutateComment(request(add("old")))
		await storage.upsertDiagram("tools", JSON.stringify(graph))
		let view = await boards.read({ taskId: "owner", viewLatest: false })
		assert.equal(view.panes[0].version, 2)
		assert.deepEqual(JSON.parse(view.panes[0].commentsJson!), [])
		assert.deepEqual(JSON.parse(view.panes[0].pendingReviewsJson!), [{ version: 1, count: 1 }])
		await boards.open({ taskId: identity.taskId, name: identity.name, mode: "comparison", startVersion: 2, endVersion: 1 })
		await boards.read({ taskId: "owner", viewLatest: false })
		await boards.mutateComment(request(add("new"), 2))
		view = await boards.read({ taskId: "owner", viewLatest: false })
		assert.deepEqual(
			view.panes.map((pane) => [pane.version, JSON.parse(pane.commentsJson!)[0].id]),
			[
				[2, "new"],
				[1, "old"],
			],
		)
		view = await boards.read({ taskId: "owner", viewLatest: false, selection: { ...identity, mode: "exact" } })
		assert.equal(view.panes[0].version, 1)
		await assert.rejects(
			boards.read({ taskId: "owner", viewLatest: false, selection: { ...identity, taskId: "other", mode: "exact" } }),
			/ownership/,
		)
	})
	it("keeps sent comments immutable and rejects panel sent flags, internal mutations, arbitrary fields and wrong targets", async () => {
		await boards.mutateComment(request(add()))
		await storage.mutateReview({ identity, operation: "mark_sent", commentIds: ["c"] })
		for (const mutation of [
			{ operation: "edit_comment", commentId: "c", text: "Changed" },
			{ operation: "delete_comment", commentId: "c" },
			{ operation: "mark_sent", commentIds: ["c"] },
			{ operation: "save_presentation", presentation: { positions: {} } },
			{ ...add(), identity },
			{ operation: "add_comment", comment: { ...add().comment, sent: true } },
			add("wrong", { kind: "node", id: "e" }),
		])
			await assert.rejects(boards.mutateComment(request(mutation)))
		await boards.mutateComment(request(add("correction")))
		assert.deepEqual(
			(await storage.readReview(identity)).comments.map((comment) => comment.sent),
			[true, false],
		)
		await assert.rejects(boards.mutateComment({ ...request(add()), taskId: "other" }))
		await assert.rejects(boards.mutateComment(request(add(), 2)), /not been displayed/)
		await assert.rejects(boards.mutateComment({ ...request(add()), mutationJson: " ".repeat(256 * 1024 + 1) }), /bytes/)
	})
	it("preserves corrupt sidecars, distinguishes history failure from current comments, and leaves publication usable", async () => {
		const file = path.join(root, "architecture/tools/v1.review.json")
		await fs.writeFile(file, "broken review")
		await assert.rejects(boards.mutateComment(request(add())))
		let pane = (await boards.read({ taskId: "owner", viewLatest: false })).panes[0]
		assert.equal(pane.commentsJson, undefined)
		assert.match(pane.reviewError!, /unavailable/)
		await storage.upsertDiagram("tools", JSON.stringify(graph))
		pane = (await boards.read({ taskId: "owner", viewLatest: false })).panes[0]
		assert.equal(pane.commentsJson, "[]")
		assert.match(pane.historyError!, /incomplete/)
		await boards.mutateComment(request(add(), 2))
		assert.equal(await fs.readFile(file, "utf8"), "broken review")
	})
	it("retries failed writes and lost acknowledgements without duplicate comments or resurrected deletions", async () => {
		const rename = sinon
			.stub(fs, "rename")
			.onFirstCall()
			.rejects(Object.assign(new Error("denied"), { code: "EACCES" }))
		rename.callThrough()
		await assert.rejects(boards.mutateComment(request(add())), /EACCES/)
		assert.deepEqual((await storage.readReview(identity)).comments, [])
		await boards.mutateComment(request(add()))
		await boards.mutateComment(request(add()))
		assert.equal((await storage.readReview(identity)).comments.length, 1)
		await assert.rejects(
			boards.mutateComment(request({ ...add(), comment: { ...add().comment, text: "Conflicting retry" } })),
			/different content/,
		)
		for (let i = 0; i < 2; i++) await boards.mutateComment(request({ operation: "delete_comment", commentId: "c" }))
		assert.deepEqual((await storage.readReview(identity)).comments, [])
	})
	it("rejects stale/deleted panel requests and forbids conversation input RPCs", async () => {
		for (const method of ["askResponse", "steerTask", "mark_sent"]) {
			let response: ExtensionMessage | undefined
			await panel.onMessage(
				{
					type: "grpc_request",
					grpc_request: {
						request_id: "x",
						service: "dirac.ArchitectureService",
						method,
						message: identity,
						is_streaming: false,
					},
				},
				async (value) => {
					response = value
					return true
				},
			)
			assert.match(response!.grpc_response!.error!, /only read or review/)
		}
		panel.onDispose()
		await assert.rejects(boards.mutateComment(request(add())), /closed/)
		await boards.open({ taskId: identity.taskId, name: identity.name, mode: "latest" })
		await boards.read({ taskId: "owner", viewLatest: false })
		invalidateArchitectureTask(root)
		await fs.rm(root, { recursive: true, force: true })
		await assert.rejects(boards.mutateComment(request(add())), /deleted/)
		await assert.rejects(fs.stat(root), { code: "ENOENT" })
	})
})
