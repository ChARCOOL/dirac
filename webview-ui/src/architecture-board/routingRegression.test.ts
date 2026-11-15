import { describe, expect, it } from "vitest"
import ELK from "elkjs/lib/elk.bundled.js"
import type { ElkNode } from "elkjs/lib/elk-api"
import type { ArchitectureDiagram } from "@shared/architecture"
import connected from "./fixtures/goals-connected.json"
import { arrangeCandidates, layoutCandidates } from "./layoutCandidates"
import { fromElkGraph, toElkGraph } from "./layoutGraph"
import { measureLayout } from "./layoutQuality"
import { routeLayout } from "./routeLayout"
import { routeLength } from "./routeGeometry"
import { planLineJumps } from "./lineJumps"
import { applyLayoutPorts, fixedLayoutFromNodes, restoreUnchangedGroupSizes, toFlowGraph } from "./flowGraph"

const diagram = connected as ArchitectureDiagram
const heights = { component: 96, api_endpoint: 96, service: 96, class: 102, function: 80, database: 112, group: 220 }
const input = {
	diagram,
	dimensions: Object.fromEntries(diagram.nodes.map((node) => [node.id, { width: 248, height: heights[node.kind] }])),
}

describe("Connected architecture routing regression", () => {
	it("shortens the retained cross-group route without moving the saved drawing", async () => {
		const raw = fromElkGraph(await new ELK().layout(toElkGraph(input, { wrapRoot: true, wrapGroups: true, compact: true })))
		// These are the reproduced presentation's local positions, not router inputs.
		expect(raw.positions.entry).toEqual({ x: 72, y: 12 })
		expect(raw.positions.goal).toEqual({ x: 77, y: 351 })
		expect(raw.positions.coordinator).toEqual({ x: 856, y: 366 })
		expect(routeLength(raw.routes["entry-goal"])).toBe(6234)
		const result = routeLayout(diagram, raw)
		expect(result.layout.positions).toEqual(raw.positions)
		expect(result.layout.sizes).toEqual(raw.sizes)
		expect(routeLength(result.layout.routes["entry-goal"])).toBeLessThan(2000)
		expect(result.layout.routes["entry-goal"].length - 2).toBeLessThanOrEqual(6)
		expect(result.metrics.exhausted).toBe(false)
		expect(result.metrics.retained).toEqual([])
		expect(result.metrics.restored).toEqual([])
		expect(result.metrics.checks).toBeLessThanOrEqual(4_000_000)
		expect(result.metrics).toMatchObject({ portChecks: expect.any(Number) })
		expect(measureLayout(diagram, result.layout).invalid).toBeUndefined()
		expect(planLineJumps(diagram, result.layout).issues).toEqual([])
		expect(routeLayout(diagram, raw)).toEqual(result)
	}, 10_000)

	it.each([0, 24])("recovers live ports without retained ELK routes after a %spx move", async (movement) => {
		const elk = new ELK()
		const candidates = layoutCandidates(input)
		const graphs: ElkNode[] = []
		for (const candidate of candidates) graphs.push(await elk.layout(toElkGraph(input, candidate.options)))
		let index = 0
		const arranged = arrangeCandidates(input, () => structuredClone(graphs[index++]))
		const old = fromElkGraph(graphs[candidates.findIndex((candidate) => candidate.id === "both-compact")])
		const positions = { ...old.positions, entry: { ...old.positions.entry, x: old.positions.entry.x + movement } }
		const presentation = { positions, viewport: { x: 52, y: 201, zoom: 0.54 } }
		const flow = toFlowGraph(diagram, presentation)
		// The saved reproduction used these dimensions; its CSS and measured bounds must agree.
		const measured = flow.nodes.map((node) => ({
			...node,
			style: node.data.semantic.kind === "group" ? node.style : input.dimensions[node.id],
			measured: input.dimensions[node.id],
		}))
		const nodes = applyLayoutPorts(restoreUnchangedGroupSizes(measured, arranged), arranged)
		const fixed = fixedLayoutFromNodes(nodes, flow.edges)
		const recovered = routeLayout(diagram, fixed, true)
		expect(recovered.layout.positions).toEqual(presentation.positions)
		expect(recovered.layout.sizes).toEqual(fixed.sizes)
		expect(routeLength(recovered.layout.routes["entry-goal"])).toBeLessThan(2000)
		expect(measureLayout(diagram, recovered.layout).invalid).toBeUndefined()
		expect(planLineJumps(diagram, recovered.layout).issues).toEqual([])
		index = 0
		expect(arrangeCandidates(input, () => structuredClone(graphs[index++]))).toEqual(arranged)
	}, 10_000)
	it.each([0, 24])("recovers current styled node geometry after a %spx move", async (movement) => {
		const flow = toFlowGraph(diagram)
		const dimensions = Object.fromEntries(
			flow.nodes.map((node) => [
				node.id,
				{
					width: Number(node.style!.width),
					height: Number(node.style!.height),
				},
			]),
		)
		const currentInput = { diagram, dimensions }
		const elk = new ELK()
		const outcomes: Array<{ graph: ElkNode } | { error: unknown }> = []
		for (const candidate of layoutCandidates(currentInput)) {
			try {
				outcomes.push({ graph: await elk.layout(toElkGraph(currentInput, candidate.options)) })
			} catch (error) {
				outcomes.push({ error })
			}
		}
		const arranged = arrangeCandidates(currentInput, () => {
			const outcome = outcomes.shift()!
			if ("error" in outcome) throw outcome.error
			return outcome.graph
		})
		const positions = {
			...arranged.positions,
			entry: { ...arranged.positions.entry, x: arranged.positions.entry.x + movement },
		}
		const measured = toFlowGraph(diagram, { positions }).nodes.map((node) => ({ ...node, measured: dimensions[node.id] }))
		const nodes = applyLayoutPorts(restoreUnchangedGroupSizes(measured, arranged), arranged)
		const fixed = fixedLayoutFromNodes(nodes, flow.edges)
		const recovered = routeLayout(diagram, fixed, true)
		expect(recovered.layout.positions).toEqual(positions)
		expect(recovered.layout.sizes).toEqual(fixed.sizes)
		expect(measureLayout(diagram, recovered.layout).invalid).toBeUndefined()
		expect(planLineJumps(diagram, recovered.layout).issues).toEqual([])
	}, 10_000)
})
