import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sinon from "sinon"
import { ArchitectureStorage } from "@core/architecture/ArchitectureStorage"
import { setHostCapabilities } from "@hosts/host-capabilities"
import { invalidateArchitectureTask } from "@core/architecture/architectureOperations"
import { ArchitectureBoardController } from "./ArchitectureBoardController"
import { resolveArchitectureCode } from "./resolveArchitectureCode"

const graph = {
	title: "Graph",
	summary: "Summary",
	nodes: [{ id: "task", kind: "class", label: "Task", code: [{ path: "source.ts", line: 1 }] }],
	edges: [],
}
const identity = { taskId: "owner", name: "tools", version: 1 }
const presentation = { positions: { task: { x: 20, y: 30 } }, viewport: { x: 2, y: 3, zoom: 0.7 } }
describe("Architecture presentation and code navigation", () => {
	let root: string
	let workspace: string
	let storage: ArchitectureStorage
	let boards: ArchitectureBoardController
	const openCode = sinon.stub()
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "board-presentation-"))
		workspace = path.join(root, "workspace")
		await fs.mkdir(workspace)
		await fs.writeFile(path.join(workspace, "source.ts"), "export class Task {}\n")
		storage = new ArchitectureStorage("owner", root)
		await storage.upsertDiagram("tools", JSON.stringify(graph))
		openCode.reset()
		openCode.resolves()
		setHostCapabilities({
			architectureViewer: {
				prepare: async () => {},
				createPanel: async () => ({ reveal() {}, dispose() {}, refresh: async () => {} }),
				openCode,
			},
		})
		boards = new ArchitectureBoardController(
			(id) => {
				if (id !== "owner") throw new Error("Wrong owner")
			},
			() => root,
			() => ({ cwd: workspace, roots: [{ name: "owned", path: workspace }] }),
		)
		await boards.open({ ...identity, mode: "exact" })
		await boards.read({ taskId: "owner", viewLatest: false })
	})
	afterEach(async () => {
		boards.dispose()
		setHostCapabilities(undefined)
		await fs.rm(root, { recursive: true, force: true })
	})
	const save = (presentationJson = JSON.stringify(presentation)) => boards.savePresentation({ ...identity, presentationJson })
	it("saves positions/viewport without semantic publication, and serializes alongside comments", async () => {
		await Promise.all([
			save(),
			storage.mutateReview({
				identity,
				operation: "add_comment",
				comment: { id: "c", target: { kind: "node", id: "task" }, text: "Keep this" },
			}),
		])
		assert.deepEqual((await storage.listDiagrams())[0].versions, [1])
		const state = await storage.readReview(identity)
		assert.deepEqual(state.presentation, presentation)
		assert.equal(state.comments.length, 1)
		const pane = (await boards.read({ taskId: "owner", viewLatest: false })).panes[0]
		assert.deepEqual(JSON.parse(pane.presentationJson!), presentation)
		assert.deepEqual(JSON.parse(pane.diagramJson), graph)
	})
	it("reuses presentation across unopened unchanged revisions without copying historical sidecars", async () => {
		await save()
		await storage.upsertDiagram("tools", JSON.stringify(graph))
		await storage.upsertDiagram("tools", JSON.stringify(graph))
		const view = await boards.read({ taskId: "owner", viewLatest: true })
		assert.equal(view.panes[0].version, 3)
		assert.deepEqual(JSON.parse(view.panes[0].presentationJson!), presentation)
		assert.equal((await storage.readReview({ ...identity, version: 2 })).presentation, undefined)
	})
	it("reuses positions only for unchanged structure and preserves historical presentation", async () => {
		await save()
		await storage.upsertDiagram(
			"tools",
			JSON.stringify({
				...graph,
				summary: "Revised",
				nodes: [{ ...graph.nodes[0], label: "Renamed", change: "modified" }],
			}),
		)
		await boards.open({ taskId: "owner", name: "tools", mode: "comparison", startVersion: 2, endVersion: 1 })
		let view = await boards.read({ taskId: "owner", viewLatest: false })
		assert.deepEqual(
			view.panes.map((pane) => JSON.parse(pane.presentationJson!)),
			[presentation, presentation],
		)
		await boards.savePresentation({
			...identity,
			version: 2,
			presentationJson: JSON.stringify({ positions: { task: { x: 99, y: 80 } } }),
		})
		assert.deepEqual((await storage.readReview(identity)).presentation, presentation)
		await storage.upsertDiagram(
			"tools",
			JSON.stringify({ ...graph, nodes: [...graph.nodes, { id: "other", kind: "service", label: "New" }] }),
		)
		view = await boards.read({ taskId: "owner", viewLatest: true })
		assert.equal(view.panes[0].presentationJson, undefined)
	})
	it("preserves corrupt review files, reports review-only failure and leaves semantic publication usable", async () => {
		const sidecar = path.join(root, "architecture/tools/v1.review.json")
		await fs.writeFile(sidecar, "broken review")
		const view = await boards.read({ taskId: "owner", viewLatest: false })
		assert.match(view.panes[0].reviewError!, /unavailable/)
		assert.equal(JSON.parse(view.panes[0].diagramJson).title, "Graph")
		await assert.rejects(save())
		assert.equal(await fs.readFile(sidecar, "utf8"), "broken review")
		assert.equal((await storage.upsertDiagram("tools", JSON.stringify(graph))).version, 2)
	})
	it("rejects unserved versions, invalid coordinates, arbitrary fields, oversized JSON and stale/deleted owners", async () => {
		await assert.rejects(boards.savePresentation({ ...identity, version: 2, presentationJson: "{}" }))
		await assert.rejects(save(JSON.stringify({ positions: { task: { x: 1e9, y: 0 } } })))
		await assert.rejects(save(JSON.stringify({ positions: { unknown: { x: 0, y: 0 } } })))
		await assert.rejects(save(" ".repeat(256 * 1024 + 1)), /bytes/)
		await assert.rejects(boards.savePresentation({ ...identity, presentationJson: "{}", operation: "mark_sent" }))
		invalidateArchitectureTask(root)
		await fs.rm(root, { recursive: true, force: true })
		await assert.rejects(save(), /deleted/)
		await assert.rejects(fs.stat(root), { code: "ENOENT" })
	})
	it("opens only persisted references in the owning workspace, with no client-supplied path or command", async () => {
		const request = { ...identity, targetKind: "node", targetId: "task", referenceIndex: 0 }
		await boards.openCode(request)
		assert.deepEqual(openCode.firstCall.args.slice(0, 3), [path.join(workspace, "source.ts"), 1, undefined])
		await assert.rejects(boards.openCode({ ...request, path: "command:evil" }))
		await assert.rejects(boards.openCode({ ...request, referenceIndex: 2 }), /does not exist/)
		await fs.writeFile(path.join(workspace, ".diracignore"), "source.ts\n")
		await assert.rejects(boards.openCode(request), /blocked/)
		assert.equal(openCode.callCount, 1)
	})
	it("resolves explicit owned roots and rejects unknown roots, directories, blocked paths and symlink escapes", async () => {
		const context = { cwd: workspace, roots: [{ name: "owned", path: workspace }] }
		assert.equal(await resolveArchitectureCode(context, { path: "@owned:source.ts" }), path.join(workspace, "source.ts"))
		await assert.rejects(resolveArchitectureCode(context, { path: "@selected:source.ts" }), /not recorded/)
		await assert.rejects(resolveArchitectureCode(context, { path: "." }), /not a file/)
		await fs.writeFile(path.join(root, "outside.ts"), "outside")
		await fs.symlink(path.join(root, "outside.ts"), path.join(workspace, "escape.ts"))
		await assert.rejects(resolveArchitectureCode(context, { path: "escape.ts" }), /leaves/)
		await fs.writeFile(path.join(workspace, ".diracignore"), "source.ts\n")
		await fs.symlink(path.join(workspace, "source.ts"), path.join(workspace, "alias.ts"))
		await assert.rejects(resolveArchitectureCode(context, { path: "alias.ts" }), /blocked/)
	})
	it("retains the owner's workspace snapshot when the selected conversation changes", async () => {
		const ownedPath = path.join(workspace, "source.ts")
		workspace = path.join(root, "another-task-workspace")
		await boards.openCode({ ...identity, targetKind: "node", targetId: "task", referenceIndex: 0 })
		assert.equal(openCode.firstCall.args[0], ownedPath)
	})
})
