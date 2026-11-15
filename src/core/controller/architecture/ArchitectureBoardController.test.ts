import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sinon from "sinon"
import { ArchitectureStorage } from "@core/architecture/ArchitectureStorage"
import { invalidateArchitectureTask } from "@core/architecture/architectureOperations"
import { notifyArchitecturePublication } from "@core/architecture/architecturePublications"
import { buildArchitectureTrait } from "@core/task/tools/adapters/traits/ArchitectureTraitBuilder"
import { setHostCapabilities } from "@hosts/host-capabilities"
import type { ArchitecturePanelOptions } from "@shared/architecture/panel"
import { ArchitectureBoardController } from "./ArchitectureBoardController"

const graph = (version: number) =>
	JSON.stringify({ title: `Title ${version}`, summary: `Summary ${version}`, nodes: [], edges: [] })
const latest = { taskId: "owner", name: "tools", mode: "latest" as const }
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("Architecture board navigation and ownership", () => {
	let root: string
	let storage: ArchitectureStorage
	let boards: ArchitectureBoardController
	let options: ArchitecturePanelOptions
	let deleted: boolean
	const refresh = sinon.stub()
	const reveal = sinon.stub()
	const dispose = sinon.stub()
	const prepare = sinon.stub()
	const createPanel = sinon.stub()

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "board-panel-"))
		storage = new ArchitectureStorage("owner", root)
		await storage.upsertDiagram("tools", graph(1))
		deleted = false
		refresh.reset()
		refresh.resolves()
		reveal.reset()
		dispose.reset()
		prepare.reset()
		prepare.resolves()
		createPanel.reset()
		createPanel.callsFake(async (input: ArchitecturePanelOptions) => {
			options = input
			dispose.callsFake(() => input.onDispose())
			return { refresh, reveal, dispose }
		})
		setHostCapabilities({ architectureViewer: { prepare, createPanel } })
		boards = new ArchitectureBoardController(
			(taskId) => {
				if (deleted || taskId !== "owner") throw new Error("owner unavailable")
			},
			() => root,
		)
	})
	afterEach(async () => {
		boards.dispose()
		setHostCapabilities(undefined)
		await fs.rm(root, { recursive: true, force: true })
	})

	it("opens and reopens latest, reuses one panel, and keeps exact/comparison versions fixed", async () => {
		await boards.open(latest)
		assert.equal((await boards.read({ taskId: "owner", viewLatest: false })).panes[0].version, 1)
		await storage.upsertDiagram("tools", graph(2))
		await boards.open(latest)
		assert.equal((await boards.read({ taskId: "owner", viewLatest: false })).panes[0].version, 2)
		await boards.open({ ...latest, mode: "exact", version: 1 })
		assert.equal((await boards.read({ taskId: "owner", viewLatest: false })).panes[0].version, 1)
		await boards.open({ ...latest, mode: "comparison", startVersion: 2, endVersion: 1 })
		assert.deepEqual(
			(await boards.read({ taskId: "owner", viewLatest: false })).panes.map((pane) => pane.version),
			[2, 1],
		)
		assert.equal((await boards.read({ taskId: "owner", viewLatest: true })).panes[0].version, 2)
		assert.equal(createPanel.callCount, 1)
	})

	it("keeps named diagrams in independent panels and scopes every panel RPC to its own session", async () => {
		await storage.upsertDiagram("details", graph(1))
		const panels = new Map<string, ArchitecturePanelOptions>()
		createPanel.callsFake(async (input: ArchitecturePanelOptions) => {
			panels.set(input.name!, input)
			return { refresh: sinon.stub().resolves(), reveal: sinon.stub(), dispose: () => input.onDispose() }
		})
		await boards.open(latest)
		await boards.open({ ...latest, name: "details" })
		assert.equal(createPanel.callCount, 2)
		await assert.rejects(boards.read({ taskId: "owner", viewLatest: false }), /Multiple architecture boards/)
		const rpc = async (panel: ArchitecturePanelOptions, method: string, message: object) => {
			const post = sinon.stub().resolves(true)
			await panel.onMessage(
				{
					type: "grpc_request",
					grpc_request: { service: "dirac.ArchitectureService", method, message, request_id: "r", is_streaming: false },
				},
				post,
			)
			return post.firstCall.args[0].grpc_response
		}
		const tools = panels.get("tools")!
		const details = panels.get("details")!
		assert.equal((await rpc(tools, "readArchitectureBoard", { taskId: "owner" })).message.panes[0].name, "tools")
		assert.equal((await rpc(details, "readArchitectureBoard", { taskId: "owner" })).message.panes[0].name, "details")
		const named = await boards.read({ taskId: "owner", viewLatest: false, selection: latest })
		assert.equal(named.panes[0].name, "tools")
		assert.match(
			(
				await rpc(tools, "readArchitectureBoard", {
					taskId: "owner",
					selection: { ...latest, name: "details" },
				})
			).error,
			/navigation ownership/,
		)
		assert.match(
			(
				await rpc(tools, "submitArchitectureFeedback", {
					taskId: "owner",
					name: "details",
					versions: [1],
				})
			).error,
			/scope changed/,
		)
		assert.match(
			(
				await rpc(tools, "mutateArchitectureComment", {
					taskId: "owner",
					name: "details",
					version: 1,
					mutationJson: JSON.stringify({
						operation: "add_comment",
						comment: { id: "comment", target: { kind: "diagram" }, text: "Wrong panel" },
					}),
				})
			).error,
			/not been displayed/,
		)
		assert.match(
			(
				await rpc(tools, "saveArchitecturePresentation", {
					taskId: "owner",
					name: "details",
					version: 1,
					presentationJson: JSON.stringify({ positions: {} }),
				})
			).error,
			/not been displayed/,
		)
		assert.match(
			(
				await rpc(tools, "openArchitectureCode", {
					taskId: "owner",
					name: "details",
					version: 1,
					targetKind: "node",
					targetId: "node",
					referenceIndex: 0,
				})
			).error,
			/not been displayed/,
		)
		tools.onDispose()
		assert.match((await rpc(tools, "readArchitectureBoard", { taskId: "owner" })).error, /stale/)
		assert.equal((await rpc(details, "readArchitectureBoard", { taskId: "owner" })).message.panes[0].name, "details")
		await boards.open(latest)
		assert.equal(createPanel.callCount, 3)
		assert.notEqual(panels.get("tools"), tools)
		assert.equal(panels.get("details"), details)
	})

	it("does not supersede a slower open for a different diagram name", async () => {
		await storage.upsertDiagram("details", graph(1))
		let release!: () => void
		prepare.onFirstCall().returns(
			new Promise<void>((resolve) => {
				release = resolve
			}),
		)
		createPanel.callsFake(async (input: ArchitecturePanelOptions) => ({
			refresh: sinon.stub().resolves(),
			reveal: sinon.stub(),
			dispose: () => input.onDispose(),
		}))
		const earlier = boards.open(latest)
		await boards.open({ ...latest, name: "details" })
		release()
		await earlier
		assert.equal(createPanel.callCount, 2)
		assert.equal((await boards.read({ taskId: "owner", viewLatest: false, selection: latest })).panes[0].name, "tools")
		assert.equal(
			(await boards.read({ taskId: "owner", viewLatest: false, selection: { ...latest, name: "details" } })).panes[0].name,
			"details",
		)
	})

	it("notifies owning latest and fixed panels; failed notifications never reverse committed writes", async () => {
		await boards.open(latest)
		refresh.resetHistory()
		notifyArchitecturePublication({ taskId: "other", name: "tools", version: 2 })
		notifyArchitecturePublication({ taskId: "owner", name: "other", version: 2 })
		await tick()
		assert.equal(refresh.callCount, 0)
		const trait = buildArchitectureTrait({
			taskId: "owner",
			foreground: true,
			canWaitForInput: true,
			resolveTaskDirectory: () => root,
		})!
		refresh.rejects(new Error("notification failed"))
		assert.deepEqual(await trait.upsertDiagram("tools", graph(2)), { name: "tools", version: 2 })
		await tick()
		assert.equal(refresh.callCount, 1)
		assert.equal((await storage.fetchDiagram("tools")).version, 2)
		refresh.resolves()
		await boards.open({ ...latest, mode: "exact", version: 1 })
		refresh.resetHistory()
		await trait.upsertDiagram("tools", graph(3))
		await tick()
		assert.equal(refresh.callCount, 1)
		const fixed = await boards.read({ taskId: "owner", viewLatest: false })
		assert.equal(fixed.panes[0].version, 1)
		assert.equal(fixed.latestVersion, 3)
		await boards.open({ ...latest, mode: "comparison", startVersion: 1, endVersion: 2 })
		refresh.resetHistory()
		await trait.upsertDiagram("tools", graph(4))
		await tick()
		assert.equal(refresh.callCount, 1)
		const comparison = await boards.read({ taskId: "owner", viewLatest: false })
		assert.deepEqual(
			comparison.panes.map((pane) => pane.version),
			[1, 2],
		)
		assert.equal(comparison.latestVersion, 4)
	})

	it("a stalled publication notification does not stall semantic publication", async () => {
		await boards.open(latest)
		refresh.callsFake(() => new Promise(() => undefined))
		const trait = buildArchitectureTrait({
			taskId: "owner",
			foreground: true,
			canWaitForInput: true,
			resolveTaskDirectory: () => root,
		})!
		assert.equal((await trait.upsertDiagram("tools", graph(2))).version, 2)
		assert.equal((await storage.fetchDiagram("tools")).version, 2)
	})

	it("a slower earlier open cannot overwrite the most recent selection", async () => {
		await storage.upsertDiagram("tools", graph(2))
		let release!: () => void
		prepare.onFirstCall().returns(
			new Promise<void>((resolve) => {
				release = resolve
			}),
		)
		const earlier = boards.open({ ...latest, mode: "exact", version: 1 })
		const rejected = assert.rejects(earlier, /superseded/)
		await boards.open(latest)
		release()
		await rejected
		const view = await boards.read({ taskId: "owner", viewLatest: false })
		assert.equal(view.selection?.mode, "latest")
		assert.equal(view.panes[0].version, 2)
		assert.equal(createPanel.callCount, 1)
	})

	it("concurrent opens share a pending panel without disposing the newer selection", async () => {
		await storage.upsertDiagram("tools", graph(2))
		let finish!: (value: { refresh: typeof refresh; reveal: typeof reveal; dispose: typeof dispose }) => void
		createPanel.callsFake(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		const earlier = boards.open({ ...latest, mode: "exact", version: 1 })
		const rejected = assert.rejects(earlier, /superseded/)
		while (!finish) await tick()
		const newer = boards.open(latest)
		while (true) {
			try {
				if ((await boards.read({ taskId: "owner", viewLatest: false })).selection?.mode === "latest") break
			} catch (error) {
				assert.match(String(error), /selection changed/)
			}
			await tick()
		}
		finish({ refresh, reveal, dispose })
		await Promise.all([rejected, newer])
		assert.equal(createPanel.callCount, 1)
		assert.equal(dispose.callCount, 0)
		assert.equal(reveal.callCount, 1)
	})

	it("rejects missing exact versions, corruption, unknown owners, and malformed requests without substituting", async () => {
		await assert.rejects(boards.open({ ...latest, mode: "exact", version: 9 }), /does not exist/)
		await assert.rejects(boards.open({ ...latest, taskId: "other" }), /owner unavailable/)
		await assert.rejects(boards.open({ ...latest, version: 1 }), /Unexpected/)
		await assert.rejects(boards.open({ ...latest, taskId: "../owner" }), /identity/)
		await assert.rejects(boards.open({ ...latest, name: "../tools" }), /name/)
		await fs.writeFile(path.join(root, "architecture/tools/v2.json"), "invalid")
		await assert.rejects(boards.open(latest))
		await boards.open({ ...latest, mode: "exact", version: 1 })
		await assert.rejects(boards.read({ taskId: "owner", viewLatest: "yes" } as never), /Invalid/)
	})

	it("allows only its own read RPC, never arbitrary chat, approvals, task selection or another owner", async () => {
		await boards.open(latest)
		for (const patch of [
			{ service: "dirac.TaskService", method: "askResponse" },
			{ method: "openArchitectureBoard" },
			{ message: { taskId: "other" } },
			{ is_streaming: true },
		]) {
			const post = sinon.stub().resolves(true)
			await options.onMessage(
				{
					type: "grpc_request",
					grpc_request: {
						service: "dirac.ArchitectureService",
						method: "readArchitectureBoard",
						request_id: "r",
						message: { taskId: "owner" },
						is_streaming: false,
						...patch,
					},
				},
				post,
			)
			assert.match(post.firstCall.args[0].grpc_response.error, /only read/)
		}
		const post = sinon.stub().resolves(true)
		await options.onMessage(
			{
				type: "grpc_request",
				grpc_request: {
					service: "dirac.ArchitectureService",
					method: "readArchitectureBoard",
					request_id: "valid",
					message: { taskId: "owner" },
					is_streaming: false,
				},
			},
			post,
		)
		assert.equal(post.firstCall.args[0].grpc_response.message.panes[0].version, 1)
	})

	it("closing releases only the panel and rejects stale callbacks; reopening creates a fresh session", async () => {
		await boards.open(latest)
		const old = options
		old.onDispose()
		await assert.rejects(boards.read({ taskId: "owner", viewLatest: false }), /closed/)
		assert.equal((await storage.fetchDiagram("tools")).version, 1)
		await boards.open(latest)
		const post = sinon.stub().resolves(true)
		await old.onMessage(
			{
				type: "grpc_request",
				grpc_request: {
					service: "dirac.ArchitectureService",
					method: "readArchitectureBoard",
					request_id: "stale",
					message: { taskId: "owner" },
					is_streaming: false,
				},
			},
			post,
		)
		assert.match(post.firstCall.args[0].grpc_response.error, /stale/)
		assert.equal(createPanel.callCount, 2)
	})

	it("missing assets, panel setup failures and nonvisual hosts leave semantic operations usable", async () => {
		prepare.rejects(new Error("assets missing"))
		await assert.rejects(boards.open(latest), /assets missing/)
		assert.equal(createPanel.callCount, 0)
		prepare.resolves()
		createPanel.rejects(new Error("panel failed"))
		await assert.rejects(boards.open(latest), /panel failed/)
		setHostCapabilities({})
		await assert.rejects(boards.open(latest), /unavailable/)
		assert.equal((await storage.fetchDiagram("tools")).version, 1)
	})

	it("deletion invalidates open panels and never recreates storage", async () => {
		await boards.open(latest)
		invalidateArchitectureTask(root)
		deleted = true
		await fs.rm(root, { recursive: true, force: true })
		await assert.rejects(boards.read({ taskId: "owner", viewLatest: false }), /unavailable/)
		await assert.rejects(boards.open(latest), /unavailable/)
		await assert.rejects(fs.stat(root), { code: "ENOENT" })
	})

	it("times out stalled panel creation, permits retry, and disposes its late result", async () => {
		const clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		let finish!: (value: { refresh: typeof refresh; reveal: typeof reveal; dispose: typeof dispose }) => void
		createPanel.onFirstCall().callsFake(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		try {
			const opening = boards.open(latest)
			const rejected = assert.rejects(opening, /timed out/)
			while (!finish) await tick()
			await clock.tickAsync(10_001)
			await rejected
			await boards.open(latest)
			const lateDispose = sinon.stub()
			finish({ refresh, reveal, dispose: lateDispose })
			await tick()
			assert.equal(lateDispose.callCount, 1)
			assert.equal(createPanel.callCount, 2)
			assert.equal((await boards.read({ taskId: "owner", viewLatest: false })).panes[0].version, 1)
		} finally {
			clock.restore()
		}
	})

	it("disposes a late panel creation rather than resurrecting a closed controller", async () => {
		let finish!: (value: { refresh: typeof refresh; reveal: typeof reveal; dispose: typeof dispose }) => void
		createPanel.callsFake(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		const opening = boards.open(latest)
		while (!finish) await tick()
		boards.dispose()
		finish({ refresh, reveal, dispose })
		await assert.rejects(opening, /disposed/)
		assert.equal(dispose.callCount, 1)
		assert.equal(reveal.callCount, 0)
	})
	it("disposes every panel and removes subscriptions even when one panel throws", async () => {
		const secondDispose = sinon.stub()
		const firstDispose = sinon.stub().throws(new Error("panel disposal failed"))
		const multiple = new ArchitectureBoardController(
			() => {},
			() => root,
		)
		createPanel.onFirstCall().resolves({ refresh, reveal, dispose: firstDispose })
		createPanel.onSecondCall().resolves({ refresh, reveal, dispose: secondDispose })
		await multiple.open(latest)
		await multiple.open({ ...latest, taskId: "other" })
		assert.throws(() => multiple.dispose(), AggregateError)
		sinon.assert.calledOnce(firstDispose)
		sinon.assert.calledOnce(secondDispose)
		refresh.resetHistory()
		notifyArchitecturePublication({ taskId: "owner", name: "tools", version: 2 })
		notifyArchitecturePublication({ taskId: "other", name: "tools", version: 2 })
		await tick()
		sinon.assert.notCalled(refresh)
		multiple.dispose()
	})
})
