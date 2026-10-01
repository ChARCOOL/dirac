import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, it } from "mocha"
import type { IToolEnvironment } from "../../../interfaces/IToolEnvironment"
import { buildToolWithRepairs } from "../subagent-builder"
import { buildScaffoldedToolSource, writeTestHarness } from "../scaffold-generator"
import { commitToolPromotion, createToolStagingDirectory, promoteStagedTool, rollbackToolPromotion } from "../tool-lifecycle"
import { TOOL_IMPLEMENTATION_SENTINEL } from "../constants"
import { SubagentExecutionStatus } from "@shared/ExtensionMessage"
import { createEmptySubagentRunStats } from "@core/task/tools/subagent/SubagentRunHelpers"

const temporaryDirectories: string[] = []

function createIdentityAllocator() {
	let nextId = 2
	return () => {
		const id = nextId++
		return { id, name: `Builder ${id}` }
	}
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe("upsert_tool support", () => {
	it("uses one exact implementation sentinel without legacy marker comments", () => {
		const source = buildScaffoldedToolSource("example_tool", "Example tool", [])
		assert.strictEqual(source.split(TOOL_IMPLEMENTATION_SENTINEL).length - 1, 1)
		assert.doesNotMatch(source, /REPLACE THIS BLOCK|END REPLACE/)
	})

	it("writes a harness with the current executeCommand result shape", async () => {
		const directory = await createTemporaryDirectory()
		await writeTestHarness(directory)
		const harness = await fs.readFile(path.join(directory, "test-harness.ts"), "utf8")

		assert.match(harness, /userRejected: false/)
		assert.match(harness, /completed: true/)
		assert.match(harness, /exitCode:/)
		assert.doesNotMatch(harness, /return \[false,/)
	})

	it("feeds parent validation failures into a bounded repair attempt", async () => {
		const prompts: string[] = []
		let validationCalls = 0
		const cardParams: any[] = []
		const env = {
			config: { taskState: { abortSignal: new AbortController().signal } },
			orchestration: {
				getHistory: () => [],
				runSubagent: async (prompt: string) => {
					prompts.push(prompt)
					return { status: SubagentExecutionStatus.COMPLETED, result: "", stats: createEmptySubagentRunStats() }
				},
			},
			ui: {
				createCard: async (params: any) => {
					cardParams.push(params)
					return {
						update: async () => { },
						finalize: async () => { },
					}
				},
			},
		} as unknown as IToolEnvironment

		const result = await buildToolWithRepairs(
			env,
			{
				name: "example_tool",
				scope: "workspace",
				description: "Example tool",
				parameters: [],
				requirements: "Return an example result.",
				toolDir: "/tmp/example-tool-build",
			},
			async () => (++validationCalls === 1 ? "smoke test failed" : undefined),
			async () => { },
			createIdentityAllocator(),
		)

		assert.strictEqual(result, undefined)
		assert.strictEqual(prompts.length, 2)
		assert.match(prompts[1], /smoke test failed/)
		assert.ok(cardParams.every((params) => params.collapsed === true))
		assert.ok(cardParams.every((params) => !/^Agent\s+\d+/.test(params.header)))
		assert.deepEqual(cardParams.map((params) => params.rawInput.agentId), [2, 3])
	})

	it("stops repair attempts when the builder subagent is cancelled", async () => {
		let validationCalls = 0
		let subagentCalls = 0
		const env = {
			config: { taskState: { abortSignal: new AbortController().signal } },
			orchestration: {
				getHistory: () => [],
				runSubagent: async () => {
					subagentCalls += 1
					return {
						status: SubagentExecutionStatus.CANCELLED,
						error: "cancelled by user",
						stats: createEmptySubagentRunStats(),
					}
				},
			},
			ui: {
				createCard: async () => ({
					update: async () => { },
					finalize: async () => { },
				}),
			},
		} as unknown as IToolEnvironment

		await assert.rejects(
			buildToolWithRepairs(
				env,
				{
					name: "example_tool",
					scope: "workspace",
					description: "Example tool",
					parameters: [],
					requirements: "Return an example result.",
					toolDir: "/tmp/example-tool-build",
				},
				async () => {
					validationCalls += 1
					return undefined
				},
				async () => { },
				createIdentityAllocator(),
			),
			/cancelled by user/,
		)
		assert.equal(subagentCalls, 1)
		assert.equal(validationCalls, 0)
	})

	it("restores the previous live directory when promotion is rolled back", async () => {
		const root = await createTemporaryDirectory()
		const finalDir = path.join(root, "tools", "example_tool")
		await fs.mkdir(finalDir, { recursive: true })
		await fs.writeFile(path.join(finalDir, "tool.ts"), "old", "utf8")

		const stagingDir = await createToolStagingDirectory(finalDir)
		await fs.writeFile(path.join(stagingDir, "tool.ts"), "new", "utf8")
		const promotion = await promoteStagedTool(stagingDir, finalDir)
		assert.strictEqual(await fs.readFile(path.join(finalDir, "tool.ts"), "utf8"), "new")

		await rollbackToolPromotion(promotion)
		assert.strictEqual(await fs.readFile(path.join(finalDir, "tool.ts"), "utf8"), "old")
	})

	it("removes the previous live backup after promotion is committed", async () => {
		const root = await createTemporaryDirectory()
		const finalDir = path.join(root, "tools", "example_tool")
		await fs.mkdir(finalDir, { recursive: true })
		await fs.writeFile(path.join(finalDir, "tool.ts"), "old", "utf8")

		const stagingDir = await createToolStagingDirectory(finalDir)
		await fs.writeFile(path.join(stagingDir, "tool.ts"), "new", "utf8")
		const promotion = await promoteStagedTool(stagingDir, finalDir)
		await commitToolPromotion(promotion)

		assert.strictEqual(await fs.readFile(path.join(finalDir, "tool.ts"), "utf8"), "new")
		if (promotion.backupDir) {
			await assert.rejects(fs.access(promotion.backupDir))
		}
	})
})

async function createTemporaryDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-upsert-tool-"))
	temporaryDirectories.push(directory)
	return directory
}
