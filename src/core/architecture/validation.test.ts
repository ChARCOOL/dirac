import { strict as assert } from "node:assert"
import type { ArchitectureDiagram, ArchitectureNode, EdgeKind, NodeKind } from "@shared/architecture"
import { describe, it } from "mocha"
import { z } from "zod"
import { ARCHITECTURE_LIMITS as limits } from "./limits"
import {
	assertDiagramName,
	assertDiagramVersion,
	parseArchitectureDiagram,
	validateArchitectureDiagram,
	validateArchitectureSelection,
	validateResolvedArchitectureIdentity,
} from "./validation"

function diagram(): ArchitectureDiagram {
	return {
		title: "Execution",
		summary: "Keep tools separate from orchestration.",
		nodes: [
			{ id: "tools", kind: "group", label: "Tools" },
			{ id: "executor", kind: "component", label: "Executor", parentId: "tools", code: [{ path: "src/executor.ts" }] },
			{ id: "storage", kind: "database", label: "Storage" },
		],
		edges: [{ id: "writes", kind: "dependency", source: "executor", target: "storage" }],
	}
}

function assertInvalidAt(value: unknown, path: (string | number)[]): void {
	assert.throws(
		() => validateArchitectureDiagram(value),
		(error: unknown) =>
			error instanceof z.ZodError && error.issues.some((issue) => JSON.stringify(issue.path) === JSON.stringify(path)),
	)
}

describe("architecture diagram validation", () => {
	it("round-trips plain semantic content without mutating it", () => {
		const value = diagram()
		const validated = validateArchitectureDiagram(value)
		assert.deepEqual(validated, value)
		assert.notEqual(validated, value)
		assert.notEqual(validated.nodes, value.nodes)
		assert.deepEqual(parseArchitectureDiagram(JSON.stringify(value)), value)
	})

	it("accepts every supported vocabulary item and proposal change", () => {
		const kinds: NodeKind[] = ["component", "class", "function", "database", "service", "api_endpoint", "group", "state", "actor"]
		const edgeKinds: EdgeKind[] = ["dependency", "aggregation", "data_flow", "api_call", "transition", "message"]
		const value = diagram()
		value.nodes = kinds.map((kind, index) => ({ id: `n${index}`, kind, label: kind, description: "Role", rationale: "Why" }))
		value.edges = edgeKinds.map((kind, index) => ({
			id: `e${index}`, kind,
			source: kind === "transition" ? "n7" : "n0",
			target: kind === "transition" ? "n7" : "n1",
			label: "uses",
		}))
		value.nodes[0].change = "added"
		value.nodes[1].change = "modified"
		value.edges[0].change = "removed"
		assert.deepEqual(validateArchitectureDiagram(value), value)
	})

	it("round-trips interaction states, actors, messages and cyclic transitions", () => {
		const value: ArchitectureDiagram = {
			title: "Feedback lifecycle", summary: "Communication and state changes are distinct.",
			nodes: [
				{ id: "human", kind: "actor", label: "Human" },
				{ id: "harness", kind: "actor", label: "Dirac harness" },
				{ id: "pending", kind: "state", label: "Pending" },
				{ id: "submitted", kind: "state", label: "Submitted" },
			],
			edges: [
				{ id: "feedback", kind: "message", source: "human", target: "harness", label: "Feedback comments" },
				{ id: "send", kind: "transition", source: "pending", target: "submitted", label: "Send Feedback [owner available]" },
				{ id: "reset", kind: "transition", source: "submitted", target: "pending" },
				{ id: "edit", kind: "transition", source: "pending", target: "pending" },
			],
		}
		assert.deepEqual(parseArchitectureDiagram(JSON.stringify(value)), value)
	})

	it("requires state endpoints for transitions without restricting message participants to actors", () => {
		const value = diagram()
		value.nodes.push({ id: "pending", kind: "state", label: "Pending" })
		for (const endpoint of ["source", "target"] as const) {
			for (const kind of ["actor", "component", "class", "function", "database", "service", "api_endpoint", "group"] as const) {
				value.nodes[1].kind = kind
				value.edges = [{ id: "invalid", kind: "transition", source: "pending", target: "pending", [endpoint]: "executor" }]
				assertInvalidAt(value, ["edges", 0, endpoint])
			}
		}
		value.edges = [{ id: "communication", kind: "message", source: "executor", target: "storage" }]
		assert.doesNotThrow(() => validateArchitectureDiagram(value))
	})

	it("allows empty graphs, relationship cycles, self-edges and separate node/edge ID namespaces", () => {
		assert.deepEqual(validateArchitectureDiagram({ title: "Empty", summary: "Start here", nodes: [], edges: [] }).nodes, [])
		const value = diagram()
		value.edges.push(
			{ id: "storage", kind: "data_flow", source: "storage", target: "executor" },
			{ id: "self", kind: "api_call", source: "storage", target: "storage" },
		)
		assert.doesNotThrow(() => validateArchitectureDiagram(value))
	})

	for (const input of [null, true, 1, [], "{}", {}, { title: "x", summary: "x", nodes: [] }]) {
		it(`rejects invalid root shape ${JSON.stringify(input)}`, () => assert.throws(() => validateArchitectureDiagram(input)))
	}

	it("rejects unsupported kinds, non-string fields and blank required text", () => {
		assertInvalidAt({ ...diagram(), title: "   " }, ["title"])
		assertInvalidAt({ ...diagram(), summary: 12 }, ["summary"])
		assertInvalidAt({ ...diagram(), nodes: [{ id: "a", kind: "react", label: "x" }] }, ["nodes", 0, "kind"])
		assertInvalidAt({ ...diagram(), edges: [{ id: "a", kind: "link", source: "executor", target: "storage" }] }, [
			"edges",
			0,
			"kind",
		])
	})

	it("rejects arbitrary properties at every semantic level instead of stripping them", () => {
		const valid = diagram()
		for (const value of [
			{ ...valid, version: 1 },
			{ ...valid, renderer: "react-flow" },
			{ ...valid, nodes: [{ ...valid.nodes[0], position: { x: 1, y: 2 } }] },
			{ ...valid, nodes: [{ ...valid.nodes[0], html: "<script>run()</script>" }] },
			{ ...valid, edges: [{ ...valid.edges[0], callback: "run()" }] },
			{ ...valid, nodes: [{ ...valid.nodes[0], code: [{ path: "src/a.ts", url: "command:run" }] }] },
		])
			assert.throws(() => validateArchitectureDiagram(value), /Unrecognized key/)
	})

	it("reports duplicate identities and missing relationship endpoints at useful locations", () => {
		const value = diagram()
		assertInvalidAt({ ...value, nodes: [...value.nodes, value.nodes[0]] }, ["nodes", 3, "id"])
		assertInvalidAt({ ...value, edges: [...value.edges, value.edges[0]] }, ["edges", 1, "id"])
		assertInvalidAt({ ...value, edges: [{ ...value.edges[0], source: "missing" }] }, ["edges", 0, "source"])
		assertInvalidAt({ ...value, edges: [{ ...value.edges[0], target: "missing" }] }, ["edges", 0, "target"])
	})

	it("requires group parents and rejects self-parenting and containment cycles", () => {
		for (const parentId of ["missing", "storage", "executor"]) {
			const value = diagram()
			value.nodes[1].parentId = parentId
			assertInvalidAt(value, ["nodes", 1, "parentId"])
		}
		const value = diagram()
		value.nodes = [
			{ id: "a", kind: "group", label: "A", parentId: "b" },
			{ id: "b", kind: "group", label: "B", parentId: "c" },
			{ id: "c", kind: "group", label: "C", parentId: "a" },
		]
		value.edges = []
		assert.throws(() => validateArchitectureDiagram(value), /Containment cycle/)
	})

	it("validates a maximum-length parent chain iteratively", () => {
		const value = diagram()
		value.nodes = Array.from(
			{ length: limits.maxNodes },
			(_, index): ArchitectureNode => ({
				id: `n${index}`,
				kind: "group",
				label: "Group",
				...(index + 1 < limits.maxNodes ? { parentId: `n${index + 1}` } : {}),
			}),
		)
		value.edges = []
		assert.doesNotThrow(() => validateArchitectureDiagram(value))
		value.nodes[value.nodes.length - 1].parentId = "n0"
		assert.throws(() => validateArchitectureDiagram(value), /Containment cycle/)
	})
})

describe("architecture resource bounds", () => {
	it("accepts exact element count limits and rejects one beyond them", () => {
		const value = diagram()
		value.nodes = Array.from({ length: limits.maxNodes }, (_, index) => ({ id: `n${index}`, kind: "component", label: "N" }))
		value.edges = Array.from({ length: limits.maxEdges }, (_, index) => ({
			id: `e${index}`,
			kind: "dependency",
			source: "n0",
			target: "n1",
		}))
		assert.doesNotThrow(() => validateArchitectureDiagram(value))
		assert.throws(() =>
			validateArchitectureDiagram({ ...value, nodes: [...value.nodes, { id: "extra", kind: "group", label: "x" }] }),
		)
		assert.throws(() => validateArchitectureDiagram({ ...value, edges: [...value.edges, value.edges[0]] }))
	})

	it("bounds strings without truncating them", () => {
		const value = diagram()
		value.title = "x".repeat(limits.maxTitleLength)
		value.summary = "x".repeat(limits.maxSummaryLength)
		value.nodes[0].label = "x".repeat(limits.maxLabelLength)
		value.nodes[0].description = "x".repeat(limits.maxDescriptionLength)
		assert.deepEqual(validateArchitectureDiagram(value), value)
		assertInvalidAt({ ...value, title: `${value.title}x` }, ["title"])
		value.nodes[0].description += "x"
		assertInvalidAt(value, ["nodes", 0, "description"])
	})

	it("bounds references both per element and across the diagram", () => {
		const value = diagram()
		const code = Array.from({ length: limits.maxCodeReferencesPerElement }, () => ({ path: "a.ts" }))
		value.nodes = Array.from({ length: limits.maxCodeReferences / code.length }, (_, index) => ({
			id: `n${index}`,
			kind: "class",
			label: "N",
			code,
		}))
		value.edges = []
		assert.doesNotThrow(() => validateArchitectureDiagram(value))
		value.nodes.push({ id: "extra", kind: "class", label: "N", code: [{ path: "a.ts" }] })
		assert.throws(() => validateArchitectureDiagram(value), /code references/)
		assertInvalidAt(
			{ ...diagram(), nodes: [{ id: "a", kind: "class", label: "N", code: [...code, { path: "a.ts" }] }], edges: [] },
			["nodes", 0, "code"],
		)
	})

	it("counts raw UTF-8 bytes before JSON parsing, including whitespace", () => {
		const raw = JSON.stringify(diagram())
		assert.doesNotThrow(() => parseArchitectureDiagram(raw.padEnd(limits.maxDiagramBytes, " ")))
		assert.throws(() => parseArchitectureDiagram(raw.padEnd(limits.maxDiagramBytes + 1, " ")), /UTF-8 bytes/)
		assert.throws(() => parseArchitectureDiagram("界".repeat(Math.ceil(limits.maxDiagramBytes / 3))), /UTF-8 bytes/)
		assert.throws(() => parseArchitectureDiagram("{"), /malformed JSON/)
	})

	it("bounds canonical bytes of object inputs as well as raw JSON", () => {
		const value = diagram()
		value.edges = []
		value.nodes = Array.from({ length: 40 }, (_, index) => ({
			id: `n${index}`,
			kind: "class",
			label: "N",
			description: "",
			rationale: "",
		}))
		let remaining = limits.maxDiagramBytes - Buffer.byteLength(JSON.stringify(value))
		for (const node of value.nodes) {
			for (const field of ["description", "rationale"] as const) {
				const count = Math.min(remaining, limits.maxDescriptionLength)
				node[field] = "x".repeat(count)
				remaining -= count
			}
		}
		assert.equal(remaining, 0)
		assert.equal(Buffer.byteLength(JSON.stringify(value)), limits.maxDiagramBytes)
		assert.doesNotThrow(() => validateArchitectureDiagram(value))
		value.summary += "x"
		assert.throws(() => validateArchitectureDiagram(value), /UTF-8 bytes/)
	})

	it("rejects oversized arrays before accessing any entries", () => {
		const nodes = new Array(limits.maxValidationCollectionEntries + 1)
		Object.defineProperty(nodes, 0, { get: () => assert.fail("Must not inspect oversized array"), enumerable: true })
		assert.throws(() => validateArchitectureDiagram({ ...diagram(), nodes }), /Collection exceeds/)
	})

	it("rejects deeply nested JSON, cycles, nonfinite/non-JSON values and accessor execution", () => {
		assert.throws(() => parseArchitectureDiagram(`${"[".repeat(10_000)}0${"]".repeat(10_000)}`), /nesting limit/)
		const cyclic: Record<string, unknown> = diagram() as unknown as Record<string, unknown>
		cyclic.cycle = cyclic
		assert.throws(() => validateArchitectureDiagram(cyclic), /Cyclic JSON/)
		for (const extra of [Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n, () => 1, new Date()]) {
			assert.throws(() => validateArchitectureDiagram({ ...diagram(), extra }))
		}
		const value = diagram()
		Object.defineProperty(value, "title", { get: () => assert.fail("Must not execute a getter"), enumerable: true })
		assert.throws(() => validateArchitectureDiagram(value), /accessors/)
	})

	it("bounds total validation visits and object collections before schema parsing", () => {
		const nested = Array.from({ length: 26 }, () => Array.from({ length: limits.maxValidationCollectionEntries }, () => null))
		assert.throws(() => validateArchitectureDiagram({ ...diagram(), nodes: nested }), /Validation value limit/)
		const extra = Object.fromEntries(
			Array.from({ length: limits.maxValidationCollectionEntries + 1 }, (_, index) => [`k${index}`, 0]),
		)
		assert.throws(() => validateArchitectureDiagram({ ...diagram(), extra }), /Collection exceeds/)
	})

	it("rejects sparse arrays and array properties that JSON would silently discard", () => {
		assert.throws(() => validateArchitectureDiagram({ ...diagram(), nodes: new Array(1) }), /dense JSON array/)
		const nodes = Object.assign([], { extra: 1 })
		assert.throws(() => validateArchitectureDiagram({ ...diagram(), nodes }), /dense JSON array/)
	})
})

describe("architecture code references", () => {
	for (const path of ["src/main.ts", "@frontend:src/my component.tsx", ".github/workflows/build.yml", "src/日本語.ts"]) {
		it(`accepts structured path ${path}`, () => {
			const value = diagram()
			value.nodes[1].code = [{ path, symbol: "Executor.run", line: 1 }]
			assert.doesNotThrow(() => validateArchitectureDiagram(value))
		})
	}
	for (const path of [
		"",
		"/etc/passwd",
		"../secret",
		"src/../secret",
		"src/./a.ts",
		"src//a.ts",
		"src/",
		"\\server\\a",
		"C:/a",
		"C:\\a",
		"~/a",
		"command:run",
		"https://example.com/a",
		"file:///a",
		"javascript:run()",
		"src/a.ts#L1",
		"%2e%2e/a",
		"src/a\u0000.ts",
		"src/a\n.ts",
		" src/a",
		"src/a.",
		"src/CON.ts",
		"@root:/a",
		"@root:../a",
		"@../root:a",
		"@:a",
	]) {
		it(`rejects unsafe path ${JSON.stringify(path)}`, () => {
			const value = diagram()
			value.nodes[1].code = [{ path }]
			assertInvalidAt(value, ["nodes", 1, "code", 0, "path"])
		})
	}
	it("requires bounded symbols and one-based integer lines", () => {
		for (const code of [
			{ path: "a.ts", line: 0 },
			{ path: "a.ts", line: 1.5 },
			{ path: "a.ts", line: limits.maxCodeLine + 1 },
			{ path: "a.ts", symbol: " " },
			{ path: "a.ts", symbol: "x".repeat(limits.maxCodeSymbolLength + 1) },
		]) {
			const value = diagram()
			value.nodes[1].code = [code]
			assert.throws(() => validateArchitectureDiagram(value))
		}
	})
})

describe("architecture identities and selections", () => {
	it("accepts safe names and versions at their boundaries", () => {
		for (const name of ["tool-execution", "a_1", "x".repeat(limits.maxNameLength)])
			assert.doesNotThrow(() => assertDiagramName(name))
		for (const version of [1, limits.maxVersion]) assert.doesNotThrow(() => assertDiagramVersion(version))
	})
	it("rejects unsafe names instead of normalizing them", () => {
		for (const name of [
			"Tools",
			undefined,
			1,
			"",
			".",
			"..",
			"a/b",
			"a\\b",
			"a:b",
			"a b",
			" x",
			"x ",
			"x.",
			"CON",
			"nul",
			"COM1",
			"__proto__",
			"constructor",
			"x".repeat(limits.maxNameLength + 1),
		]) {
			assert.throws(() => assertDiagramName(name), `Expected rejection: ${String(name)}`)
		}
		for (const version of [undefined, "1", 0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, limits.maxVersion + 1])
			assert.throws(() => assertDiagramVersion(version))
	})
	it("distinguishes latest selection from exact resolved ownership", () => {
		const identity = { taskId: "task-1", name: "tools", version: 1 }
		assert.deepEqual(validateResolvedArchitectureIdentity(identity), identity)
		for (const selection of [
			{ taskId: "task-1", name: "tools", mode: "latest" },
			{ ...identity, mode: "exact" },
			{ taskId: "task-1", name: "tools", mode: "comparison", startVersion: 3, endVersion: 1 },
		])
			assert.deepEqual(validateArchitectureSelection(selection), selection)
		for (const selection of [
			{ ...identity, mode: "latest" },
			{ ...identity, mode: "comparison" },
			{ ...identity, mode: "exact", extra: 1 },
		]) {
			assert.throws(() => validateArchitectureSelection(selection))
		}
		assert.throws(() => validateResolvedArchitectureIdentity({ taskId: "../task", name: "tools", version: 1 }))
		assert.throws(() => validateResolvedArchitectureIdentity({ taskId: "task-1", name: "tools" }))
	})
})
