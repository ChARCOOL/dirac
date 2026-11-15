import { describe, expect, it } from "vitest"
import ELK from "elkjs/lib/elk.bundled.js"
import type { ElkNode } from "elkjs/lib/elk-api"
import type { ArchitectureDiagram } from "@shared/architecture"
import reported from "./fixtures/architecture-board.json"
import nested from "./fixtures/tool-execution.json"
import parallel from "./fixtures/goals-and-subagents.json"
import compound from "./fixtures/goals-vs-subagents.json"
import wraparound from "./fixtures/goals-wraparound.json"
import ownership from "./fixtures/subagent-ownership-detail.json"
import { arrangeCandidates, layoutCandidates, selectLayout } from "./layoutCandidates"
import { fromElkGraph, toElkGraph, type LayoutCandidateMetrics } from "./layoutGraph"
import { measureLayout } from "./layoutQuality"
import { routeLayout } from "./routeLayout"
import { absoluteBoxes, routeLength } from "./routeGeometry"
import { planLineJumps } from "./lineJumps"

const inputFor = (diagram: ArchitectureDiagram) => ({
	diagram,
	dimensions: Object.fromEntries(diagram.nodes.map((node) => [node.id, { width: 248, height: 102 }])),
})
const metric = (id: string, extent: number, routeLength: number, bends: number): LayoutCandidateMetrics => ({
	id,
	extent,
	routeLength,
	bends,
	shortcuts: 0,
	checks: 0,
	exhausted: false,
})

describe("Layout candidate search", () => {
	it("includes unwrapped and compact alternatives without duplicate configurations", () => {
		const candidates = layoutCandidates(inputFor(reported as ArchitectureDiagram))
		expect(candidates).toHaveLength(8)
		expect(candidates[0]).toEqual({ id: "unwrapped", options: { wrapRoot: false, wrapGroups: false } })
		expect(new Set(candidates.map((candidate) => JSON.stringify(candidate.options))).size).toBe(candidates.length)
		const simple: ArchitectureDiagram = {
			title: "Simple",
			summary: "",
			nodes: [
				{ id: "a", kind: "component", label: "A" },
				{ id: "b", kind: "component", label: "B" },
			],
			edges: [{ id: "ab", kind: "api_call", source: "a", target: "b" }],
		}
		expect(layoutCandidates(inputFor(simple))).toHaveLength(4)
		expect(layoutCandidates(inputFor({ ...simple, edges: [] }))).toHaveLength(1)
	})
	it("bounds canvas-aware search and partitions only wrappable top-level groups", () => {
		const input = { ...inputFor(reported as ArchitectureDiagram), canvas: { width: 1600, height: 1000 } }
		const candidates = layoutCandidates(input)
		expect(candidates).toHaveLength(10)
		expect(candidates.find((candidate) => candidate.id === "panels")!.options).toMatchObject({ partitionGroups: true })
		expect(new Set(candidates.map((candidate) => JSON.stringify(candidate.options))).size).toBe(candidates.length)
		const groups = input.diagram.nodes.filter((node) => node.kind === "group")
		const connected = {
			...input,
			diagram: {
				...input.diagram,
				edges: [
					...input.diagram.edges,
					...groups.slice(1).map((group) => ({
						id: `group-link-${group.id}`,
						kind: "dependency" as const,
						source: groups[0].id,
						target: group.id,
					})),
				],
			},
		}
		expect(layoutCandidates(connected).some((candidate) => candidate.options.partitionGroups)).toBe(false)
		expect(layoutCandidates({ ...input, diagram: { ...input.diagram, edges: [] } })).toHaveLength(1)
	})
	it("does not Pareto-discard a spacious composition just because it has longer wiring", () => {
		const cramped = { ...metric("cramped", 900, 80, 1), composition: { zoom: 1, crowding: 0.8, unused: 0.7, cost: 2 } }
		const roomy = { ...metric("roomy", 1000, 100, 2), composition: { zoom: 0.9, crowding: 0, unused: 0.3, cost: 0.3 } }
		expect(selectLayout([cramped, roomy]).id).toBe("roomy")
		expect(selectLayout([roomy, cramped]).id).toBe("roomy")
		expect(selectLayout([cramped, { ...roomy, invalid: "Overlapping nodes" }]).id).toBe("cramped")
	})
	it("balances readable fit and wiring continuously, independent of enumeration order", () => {
		const candidates = [metric("shorter", 1001, 10, 2), metric("fit", 1000, 100, 3), metric("dominated", 1100, 200, 4)]
		expect(selectLayout(candidates).id).toBe("shorter")
		expect(selectLayout([...candidates].reverse()).id).toBe("shorter")
		expect(selectLayout([metric("long", 1000, 100, 2), metric("short", 1000, 90, 3)]).id).toBe("short")
		expect(selectLayout([metric("bent", 1000, 100, 3), metric("straight", 1000, 100, 2)]).id).toBe("straight")
	})
	it("does not buy a small fit improvement with a large wiring regression", () => {
		const candidates = [metric("compact", 1610, 15034, 44), metric("readable", 1650, 11048, 38)]
		expect(selectLayout(candidates).id).toBe("readable")
		const scaled = candidates.map((c) => ({ ...c, extent: c.extent * 3, routeLength: c.routeLength * 3 }))
		expect(selectLayout(scaled).id).toBe("readable")
		// Conversely, a tiny wiring improvement is not worth halving the displayed card size.
		expect(selectLayout([metric("fit", 1000, 100, 2), metric("wide", 2000, 99, 2)]).id).toBe("fit")
		expect(selectLayout([...candidates, metric("outlier", 10000, 100000, 200)]).id).toBe("readable")
		expect(selectLayout([metric("b", 1000, 100, 2), metric("a", 1000, 100, 2)]).id).toBe("a")
		expect(selectLayout([metric("large", 1000, 0, 0), metric("small", 100, 0, 0)]).id).toBe("small")
	})
	it("rejects invalid geometry before ranking and surfaces an all-invalid search", () => {
		const invalid = { ...metric("bad", 10, 10, 0), invalid: "Overlapping nodes" }
		expect(selectLayout([invalid, metric("valid", 100, 100, 2)]).id).toBe("valid")
		expect(() => selectLayout([invalid])).toThrow(/No valid layout.*Overlapping nodes/)
	})
	it("reports every engine failure when no candidate succeeds", () => {
		const input = inputFor(ownership as ArchitectureDiagram)
		let attempts = 0
		expect(() =>
			arrangeCandidates(input, () => {
				attempts++
				throw new Error("scanline failure")
			}),
		).toThrow(/No valid layout: unwrapped: ELK layout failed: scanline failure/)
		expect(attempts).toBe(layoutCandidates(input).length)
	})
	it("does not treat invalid inputs or malformed engine output as optional strategy failures", () => {
		const input = inputFor(ownership as ArchitectureDiagram)
		let attempts = 0
		expect(() =>
			arrangeCandidates({ ...input, dimensions: {} }, (graph) => {
				attempts++
				return graph
			}),
		).toThrow(/no valid measured dimensions/)
		expect(attempts).toBe(0)
		expect(() =>
			arrangeCandidates(input, (graph) => {
				attempts++
				return graph // No positions: not a valid engine result.
			}),
		).toThrow(/Layout returned invalid/)
		expect(attempts).toBe(1)
	})
	it.each([
		undefined,
		{ width: 1600, height: 1000 },
	])("retains valid ownership layouts when ELK rejects compact candidates (canvas %j)", async (canvas) => {
		const diagram = ownership as ArchitectureDiagram
		const input = { ...inputFor(diagram), canvas }
		const elk = new ELK()
		const candidates = layoutCandidates(input)
		const outcomes: Array<{ graph: ElkNode } | { error: unknown }> = []
		for (const candidate of candidates) {
			try {
				outcomes.push({ graph: await elk.layout(toElkGraph(input, candidate.options)) })
			} catch (error) {
				outcomes.push({ error })
			}
		}
		const failures = outcomes.flatMap((outcome, index) => ("error" in outcome ? [candidates[index].id] : []))
		expect(failures.length).toBeGreaterThan(0)
		expect(failures.every((id) => id.endsWith("-compact"))).toBe(true)
		let index = 0
		const result = arrangeCandidates(input, () => {
			const outcome = outcomes[index++]
			if ("error" in outcome) throw outcome.error
			return structuredClone(outcome.graph)
		})
		expect(index).toBe(candidates.length)
		expect(result.diagnostics!.selected).not.toMatch(/-compact$/)
		for (const id of failures) {
			expect(result.diagnostics!.candidates.find((candidate) => candidate.id === id)!.invalid).toMatch(
				/ELK layout failed:.*Invalid hitboxes/,
			)
		}
		expect(Object.keys(result.routes).sort()).toEqual(diagram.edges.map((edge) => edge.id).sort())
		expect(measureLayout(diagram, result).invalid).toBeUndefined()
		expect(planLineJumps(diagram, result).issues).toEqual([])
		for (const node of diagram.nodes.filter((node) => node.kind !== "group"))
			expect(result.sizes[node.id]).toEqual(input.dimensions[node.id])
	}, 10_000)
	it("cleans the reported shared hairpins while improving fit and total wiring together", async () => {
		const input = inputFor(reported as ArchitectureDiagram)
		const elk = new ELK()
		const baseline = fromElkGraph(await elk.layout(toElkGraph(input, { wrapGroups: true })))
		const graphs: ElkNode[] = []
		for (const candidate of layoutCandidates(input)) graphs.push(await elk.layout(toElkGraph(input, candidate.options)))
		const result = arrangeCandidates(input, () => structuredClone(graphs.shift()!))
		const before = measureLayout(input.diagram, baseline)
		const after = measureLayout(input.diagram, result)
		expect(after.invalid).toBeUndefined()
		expect(after.extent).toBeLessThanOrEqual(before.extent)
		expect(after.routeLength).toBeLessThan(before.routeLength * 0.65)
		expect(after.bends).toBeLessThan(before.bends)
		for (const id of ["publication-refresh", "navigation-controller", "tool-storage"])
			expect(routeLength(result.routes[id])).toBeLessThan(routeLength(baseline.routes[id]) * 0.65)
		const selected = result.diagnostics!.candidates.find((candidate) => candidate.id === result.diagnostics!.selected)!
		expect(selected.shortcuts).toBeGreaterThanOrEqual(5)
		expect(selected.unbridged).toBe(0)
		// A bounded search may exhaust while safe original routes preserve the better placement.
		expect(selected.invalid).toBeUndefined()
		expect(planLineJumps(input.diagram, result).issues).toEqual([])
		expect(Object.values(result.decorations!).reduce((sum, value) => sum + value.jumps.length, 0)).toBeGreaterThan(0)
	}, 10_000)
	it.each([
		nested,
		parallel,
	])("preserves topology, measured cards and deterministic route recovery: $title", async (fixture) => {
		const diagram = fixture as ArchitectureDiagram
		const input = inputFor(diagram)
		const elk = new ELK()
		const graphs: ElkNode[] = []
		for (const candidate of layoutCandidates(input)) graphs.push(await elk.layout(toElkGraph(input, candidate.options)))
		let index = 0
		const result = arrangeCandidates(input, () => structuredClone(graphs[index++]))
		expect(Object.keys(result.routes).sort()).toEqual(diagram.edges.map((edge) => edge.id).sort())
		for (const node of diagram.nodes.filter((node) => node.kind !== "group"))
			expect(result.sizes[node.id]).toEqual(input.dimensions[node.id])
		expect(measureLayout(diagram, result).invalid).toBeUndefined()
		index = 0
		expect(arrangeCandidates(input, () => structuredClone(graphs[index++]))).toEqual(result)
	}, 10_000)
	it.each([
		{ fixture: reported, height: 90 },
		{ fixture: reported, height: 100 },
		{ fixture: compound, height: 100 },
	])("keeps screen-shaped placements despite tight hops and fractional ports (height $height)", async ({ fixture, height }) => {
		const diagram = fixture as ArchitectureDiagram
		const input = { diagram, dimensions: Object.fromEntries(diagram.nodes.map((node) => [node.id, { width: 248, height }])) }
		const elk = new ELK()
		const candidates = layoutCandidates(input)
		const graphs: ElkNode[] = []
		for (const candidate of candidates) graphs.push(await elk.layout(toElkGraph(input, candidate.options)))
		let index = 0
		const result = arrangeCandidates(input, () => structuredClone(graphs[index++]))
		const selected = result.diagnostics!.candidates.find((candidate) => candidate.id === result.diagnostics!.selected)!
		const raw = fromElkGraph(graphs[candidates.findIndex((candidate) => candidate.id === selected.id)])
		expect(result.positions).toEqual(raw.positions)
		expect(result.sizes).toEqual(raw.sizes)
		const boxes = absoluteBoxes(diagram, result)
		const width = Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x))
		const drawingHeight = Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y))
		expect(width / drawingHeight).toBeGreaterThan(1.4)
		expect(width / drawingHeight).toBeLessThan(2.2)
		expect(measureLayout(diagram, result).invalid).toBeUndefined()
		expect(planLineJumps(diagram, result).issues).toEqual([])
		expect(selected.restored).toEqual([])
		expect(selected.exhausted).toBe(false)
	}, 10_000)
	it.each([90, 100, 102])("shortens the reported wraparound chart without rolling back routes (height %s)", async (height) => {
		const diagram = wraparound as ArchitectureDiagram
		const input = { diagram, dimensions: Object.fromEntries(diagram.nodes.map((node) => [node.id, { width: 248, height }])) }
		const elk = new ELK()
		const candidates = layoutCandidates(input)
		const graphs: ElkNode[] = []
		for (const candidate of candidates) graphs.push(await elk.layout(toElkGraph(input, candidate.options)))
		let index = 0
		const result = arrangeCandidates(input, () => structuredClone(graphs[index++]))
		const selected = result.diagnostics!.candidates.find((c) => c.id === result.diagnostics!.selected)!
		const original = fromElkGraph(graphs[candidates.findIndex((c) => c.id === selected.id)])
		expect(result.positions).toEqual(original.positions)
		expect(result.sizes).toEqual(original.sizes)
		expect(selected.restored).toEqual([])
		expect(selected.retained).toEqual([])
		expect(selected.exhausted).toBe(false)
		expect(selected.routeLength).toBeLessThan(measureLayout(diagram, original).routeLength * 0.45)
		for (const id of ["g-workspace", "g-dispatch", "g-wait", "g-start-return", "s-return", "s-join"])
			expect(routeLength(result.routes[id])).toBeLessThan(routeLength(original.routes[id]) * 0.6)
		// The direct 20px corridor continues into the current socket's 18%-width recess.
		expect(result.routes["g-request"]).toHaveLength(2)
		expect(routeLength(result.routes["g-request"])).toBeCloseTo(20 + 248 * 0.18)
		expect(planLineJumps(diagram, result).issues).toEqual([])
		const boxes = absoluteBoxes(diagram, result)
		const width = Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x))
		const drawingHeight = Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y))
		expect(width / drawingHeight).toBeLessThan(2.5)
		index = 0
		expect(arrangeCandidates(input, () => structuredClone(graphs[index++]))).toEqual(result)
	}, 10_000)
	it("supports group endpoints without treating the whole owning subsystem as a solid obstacle", async () => {
		const diagram: ArchitectureDiagram = {
			title: "Group endpoint",
			summary: "",
			nodes: [
				{ id: "g", kind: "group", label: "G" },
				{ id: "a", kind: "component", label: "A", parentId: "g" },
				{ id: "b", kind: "component", label: "B" },
			],
			edges: [
				{ id: "inside", kind: "api_call", source: "g", target: "a" },
				{ id: "outside", kind: "data_flow", source: "g", target: "b" },
			],
		}
		const input = inputFor(diagram)
		const elk = new ELK()
		const graphs: ElkNode[] = []
		for (const candidate of layoutCandidates(input)) graphs.push(await elk.layout(toElkGraph(input, candidate.options)))
		const result = arrangeCandidates(input, () => graphs.shift()!)
		expect(Object.keys(result.routes).sort()).toEqual(["inside", "outside"])
		expect(measureLayout(diagram, result).invalid).toBeUndefined()
		const rerouted = routeLayout(diagram, result, true)
		expect(rerouted.metrics.retained).toEqual([])
		expect(measureLayout(diagram, rerouted.layout).invalid).toBeUndefined()
	}, 10_000)
})
