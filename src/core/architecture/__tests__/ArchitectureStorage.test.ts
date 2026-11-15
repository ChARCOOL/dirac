import * as atomicWrite from "@core/storage/atomicWrite"
import { deleteTaskDirectory } from "@core/storage/taskDirectory"
import type { ArchitectureDiagram, ResolvedArchitectureIdentity } from "@shared/architecture"
import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { ArchitectureStorage } from "../ArchitectureStorage"
import { ARCHITECTURE_LIMITS } from "../limits"

const diagram: ArchitectureDiagram = {
	title: "Tools",
	summary: "Task-local planning",
	nodes: [{ id: "tool", kind: "component", label: "Tool" }],
	edges: [],
}
const json = JSON.stringify(diagram)

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

async function failure(promise: Promise<unknown>, text: string): Promise<void> {
	try {
		await promise
		expect.fail("Expected operation to fail")
	} catch (error) {
		expect((error as Error).message).to.include(text)
	}
}

describe("ArchitectureStorage", () => {
	let sandbox: sinon.SinonSandbox
	let root: string
	let task: string
	let storage: ArchitectureStorage
	const identity: ResolvedArchitectureIdentity = { taskId: "task", name: "tools", version: 1 }

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		root = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-architecture-"))
		task = path.join(root, "tasks", "task")
		await fs.mkdir(task, { recursive: true })
		sandbox.stub(HostProvider, "get").returns({ globalStorageFsPath: root } as ReturnType<typeof HostProvider.get>)
		storage = new ArchitectureStorage("task", task)
	})

	afterEach(async () => {
		sandbox.restore()
		await fs.rm(root, { recursive: true, force: true })
	})

	it("does no I/O on construction or create storage when listing an empty task", async () => {
		expect(await storage.listDiagrams()).to.deep.equal([])
		expect(await fs.readdir(task)).to.deep.equal([])
	})

	it("serializes distinct immutable versions across store instances and names", async () => {
		const other = new ArchitectureStorage("task", task)
		const versions = await Promise.all(
			Array.from({ length: 12 }, (_, i) => (i % 2 ? storage : other).upsertDiagram("tools", json)),
		)
		expect(versions.map((entry) => entry.version)).to.deep.equal(Array.from({ length: 12 }, (_, i) => i + 1))
		await storage.upsertDiagram("api", json)
		expect(await storage.listDiagrams()).to.deep.equal([
			{ name: "api", versions: [1] },
			{ name: "tools", versions: Array.from({ length: 12 }, (_, i) => i + 1) },
		])
		expect(await storage.fetchDiagram("tools")).to.deep.equal({ name: "tools", version: 12, diagram })
		expect(await other.fetchDiagram("tools", 1)).to.deep.equal({ name: "tools", version: 1, diagram })
		expect(JSON.parse(await fs.readFile(path.join(task, "architecture/tools/v1.json"), "utf8"))).to.deep.equal(diagram)
	})

	it("rejects invalid writes without publishing and never substitutes missing versions", async () => {
		await failure(storage.upsertDiagram("../outside", json), "name")
		await failure(storage.upsertDiagram("tools", "{}"), "title")
		expect(await storage.listDiagrams()).to.deep.equal([])
		await failure(storage.fetchDiagram("missing"), "does not exist")
		await storage.upsertDiagram("tools", json)
		await failure(storage.fetchDiagram("tools", 2), "version 2 does not exist")
	})

	it("ignores temporary files and sidecars for latest; corrupt latest never falls back", async () => {
		await storage.upsertDiagram("tools", json)
		const directory = path.join(task, "architecture/tools")
		await fs.writeFile(path.join(directory, "v99.review.json"), "{}")
		await fs.writeFile(path.join(directory, "v100.json.tmp.1.json"), json)
		expect((await storage.fetchDiagram("tools")).version).to.equal(1)
		await fs.writeFile(path.join(directory, "v2.json"), "{}")
		await failure(storage.fetchDiagram("tools"), "title")
		expect((await storage.fetchDiagram("tools", 1)).diagram).to.deep.equal(diagram)
		expect(await storage.listDiagrams()).to.deep.equal([{ name: "tools", versions: [1, 2] }])
	})

	it("validates saved semantic data and bounds disk reads", async () => {
		await storage.upsertDiagram("tools", json)
		const file = path.join(task, "architecture/tools/v1.json")
		await fs.writeFile(file, JSON.stringify({ ...diagram, renderer: "forbidden" }))
		await failure(storage.fetchDiagram("tools"), "renderer")
		await fs.truncate(file, ARCHITECTURE_LIMITS.maxDiagramBytes + 1)
		await failure(storage.fetchDiagram("tools"), "byte limit")
	})

	it("preserves corrupt review state while semantic fetch and publication remain usable", async () => {
		await storage.upsertDiagram("tools", json)
		const file = path.join(task, "architecture/tools/v1.review.json")
		await fs.writeFile(file, "{broken")
		expect((await storage.fetchDiagram("tools")).diagram).to.deep.equal(diagram)
		expect((await storage.upsertDiagram("tools", json)).version).to.equal(2)
		await failure(storage.readReview(identity), "JSON")
		await failure(
			storage.mutateReview({
				identity,
				operation: "add_comment",
				comment: { id: "c", target: { kind: "diagram" }, text: "Keep" },
			}),
			"JSON",
		)
		expect(await fs.readFile(file, "utf8")).to.equal("{broken")
	})

	it("serializes comment and presentation mutations without creating semantic revisions", async () => {
		await storage.upsertDiagram("tools", json)
		expect(await storage.readReview(identity)).to.deep.equal({ comments: [] })
		await Promise.all([
			storage.mutateReview({
				identity,
				operation: "add_comment",
				comment: { id: "c", target: { kind: "node", id: "tool" }, text: "Keep boundary" },
			}),
			storage.mutateReview({
				identity,
				operation: "save_presentation",
				presentation: { positions: { tool: { x: 10, y: 20 } }, viewport: { x: 0, y: 0, zoom: 1 } },
			}),
		])
		const review = await storage.readReview(identity)
		expect(review.comments).to.have.length(1)
		expect(review.presentation?.positions.tool).to.deep.equal({ x: 10, y: 20 })
		await storage.mutateReview({ identity, operation: "mark_sent", commentIds: ["c"] })
		await failure(storage.mutateReview({ identity, operation: "edit_comment", commentId: "c", text: "Changed" }), "Sent")
		await failure(
			storage.mutateReview({ identity: { ...identity, taskId: "other" }, operation: "delete_comment", commentId: "c" }),
			"different task",
		)
		expect(await storage.listDiagrams()).to.deep.equal([{ name: "tools", versions: [1] }])
	})

	it("recovers its write queue after rejection and keeps unrelated diagrams usable", async () => {
		const rename = sandbox
			.stub(fs, "rename")
			.onFirstCall()
			.rejects(Object.assign(new Error("disk denied"), { code: "EACCES" }))
		rename.callThrough()
		await failure(storage.upsertDiagram("tools", json), "EACCES")
		expect(await storage.upsertDiagram("api", json)).to.deep.equal({ name: "api", version: 1 })
		expect(await storage.upsertDiagram("tools", json)).to.deep.equal({ name: "tools", version: 1 })
	})

	it("enforces task byte quotas without loading corrupt sidecars", async () => {
		await storage.upsertDiagram("tools", json)
		const file = path.join(task, "architecture/tools/v1.review.json")
		await fs.writeFile(file, "")
		await fs.truncate(file, ARCHITECTURE_LIMITS.maxTaskStorageBytes)
		await failure(storage.upsertDiagram("api", json), "task limit")
		expect(await fs.readdir(path.join(task, "architecture"))).to.deep.equal(["tools"])
		expect((await storage.fetchDiagram("tools")).version).to.equal(1)
		await fs.unlink(file)
		expect((await storage.upsertDiagram("api", json)).version).to.equal(1)
	})

	it("rejects exhausted per-diagram version sequences", async () => {
		await storage.upsertDiagram("tools", json)
		await fs.writeFile(path.join(task, `architecture/tools/v${ARCHITECTURE_LIMITS.maxVersionsPerDiagram}.json`), json)
		await failure(storage.upsertDiagram("tools", json), "version limit")
	})

	it("rejects a symlinked named directory before reading its version inventory", async () => {
		await storage.upsertDiagram("tools", json)
		await fs.symlink(path.join(task, "architecture/tools"), path.join(task, "architecture/alias"), "dir")
		await failure(storage.upsertDiagram("alias", json), "real directory")
		expect((await storage.fetchDiagram("tools")).version).to.equal(1)
	})

	it("does not follow board directory or semantic-file symlinks", async () => {
		await fs.symlink(root, path.join(task, "architecture"), "dir")
		await failure(storage.upsertDiagram("tools", json), "real directory")
		await fs.unlink(path.join(task, "architecture"))
		await storage.upsertDiagram("tools", json)
		const file = path.join(task, "architecture/tools/v1.json")
		await fs.unlink(file)
		await fs.symlink(path.join(root, "outside.json"), file)
		await failure(storage.fetchDiagram("tools", 1), "ELOOP")
	})

	it("invalidates active and queued requests immediately on deletion without late recreation", async () => {
		const started = deferred()
		const release = deferred()
		const original = atomicWrite.atomicWriteFile
		sandbox.stub(atomicWrite, "atomicWriteFile").callsFake(async (file, content) => {
			started.resolve()
			await release.promise
			return original(file, content)
		})
		const active = failure(storage.upsertDiagram("tools", json), "deleted")
		await started.promise
		const queued = failure(storage.upsertDiagram("tools", json), "deleted")
		await deleteTaskDirectory("task")
		await Promise.all([active, queued])
		await failure(storage.fetchDiagram("tools"), "deleted")
		await failure(new ArchitectureStorage("task", task).upsertDiagram("tools", json), "deleted")
		release.resolve()
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(await fs.readdir(path.join(root, "tasks"))).to.deep.equal([])
	})

	it("a late nonrecursive directory creation cannot recreate a deleted task", async () => {
		const started = deferred()
		const release = deferred()
		const original = fs.mkdir.bind(fs)
		sandbox.stub(fs, "mkdir").callsFake(async (directory, options) => {
			if (String(directory) === path.join(task, "architecture")) {
				started.resolve()
				await release.promise
			}
			return original(directory, options)
		})
		const active = failure(storage.upsertDiagram("tools", json), "deleted")
		await started.promise
		await deleteTaskDirectory("task")
		await active
		release.resolve()
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(await fs.readdir(path.join(root, "tasks"))).to.deep.equal([])
	})

	it("bounds caller waiting without releasing write order; other names remain usable", async () => {
		const started = deferred()
		const release = deferred()
		const original = atomicWrite.atomicWriteFile
		sandbox.stub(atomicWrite, "atomicWriteFile").callsFake(async (file, content) => {
			if (file.endsWith("tools/v1.json")) {
				started.resolve()
				await release.promise
			}
			return original(file, content)
		})
		const clock = sandbox.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		const active = failure(storage.upsertDiagram("tools", json), "timed out")
		await started.promise
		const queued = failure(storage.upsertDiagram("tools", json), "timed out")
		expect((await storage.upsertDiagram("api", json)).version).to.equal(1)
		await clock.tickAsync(ARCHITECTURE_LIMITS.operationTimeoutMs)
		await Promise.all([active, queued])
		release.resolve()
		clock.restore()
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect((await storage.upsertDiagram("tools", json)).version).to.equal(2)
	})
})
