import { describe, expect, it } from "vitest"
import ELK from "elkjs/lib/elk.bundled.js"
import type { ArchitectureDiagram } from "@shared/architecture"
import fixture from "./fixtures/tool-execution.json"
import { toFlowGraph, STRUCTURE_LOCK } from "./flowGraph"
import { fromElkGraph, toElkGraph } from "./layoutGraph"

const diagram = fixture as ArchitectureDiagram
const dimensions = Object.fromEntries(diagram.nodes.map((node) => [node.id, { width: 230, height: 120 }]))
describe("Architecture conversion and concrete ELK layout", () => {
	it("keeps stable semantic IDs, parents before children, and kind/change/selection separate", () => {
		const { nodes, edges } = toFlowGraph(diagram)
		for (const node of nodes) {
			if (node.parentId) expect(nodes.findIndex((item) => item.id === node.parentId)).toBeLessThan(nodes.indexOf(node))
			expect(node.data.semantic).toEqual(diagram.nodes.find((item) => item.id === node.id))
			expect(node.connectable).toBe(false)
			expect(node.deletable).toBe(false)
		}
		for (const group of nodes.filter((node) => node.data.semantic.kind === "group")) {
			expect(group.dragHandle).toBe(".node-group-drag-handle")
			expect(group.style).toMatchObject({ pointerEvents: "none" })
		}
		expect(edges.every((edge) => !edge.deletable && !edge.reconnectable && edge.interactionWidth === 28)).toBe(true)
		expect(STRUCTURE_LOCK).toEqual({
			nodesConnectable: false,
			edgesReconnectable: false,
			deleteKeyCode: null,
			connectOnClick: false,
		})
	})
	it("restores relative positions and computes group bounds without persisting renderer data", () => {
		const { nodes } = toFlowGraph(diagram, { positions: { task: { x: 400, y: 300 } }, viewport: { x: 10, y: 20, zoom: 0.5 } })
		expect(nodes.find((node) => node.id === "task")!.position).toEqual({ x: 400, y: 300 })
		expect(Number(nodes.find((node) => node.id === "core")!.style!.width)).toBeGreaterThan(630)
	})
	it("lays out a real subsystem with nested groups, cross-group links, cycles, self links and long labels", async () => {
		const elk = new ELK()
		const result = fromElkGraph(await elk.layout(toElkGraph({ diagram, dimensions })))
		expect(Object.keys(result.positions).sort()).toEqual(diagram.nodes.map((node) => node.id).sort())
		expect(result.sizes.core.width).toBeGreaterThan(result.sizes.task.width)
		for (const position of Object.values(result.positions)) expect(Number.isFinite(position.x + position.y)).toBe(true)
		const reordered = { ...diagram, nodes: [...diagram.nodes].reverse(), edges: [...diagram.edges].reverse() }
		expect(toElkGraph({ diagram: reordered, dimensions })).toEqual(toElkGraph({ diagram, dimensions }))
	}, 10000)
	it("does not feed previously expanded group bounds back into the next arrangement", () => {
		const expanded = { ...dimensions }
		for (const node of diagram.nodes) {
			if (node.kind === "group") expanded[node.id] = { width: 4000, height: 3000 }
		}
		for (const options of [{}, { wrapGroups: true }, { wrapGroups: true, wrapRoot: false }]) {
			expect(toElkGraph({ diagram, dimensions: expanded }, options)).toEqual(toElkGraph({ diagram, dimensions }, options))
		}
	})
	it.each([
		"api_call",
		"aggregation",
		"data_flow",
		"dependency",
	] as const)("does not force callers with incoming %s relationships into FIRST", async (kind) => {
		const diagram: ArchitectureDiagram = {
			title: "Incoming relationships",
			summary: "A grouped caller is not a graph entry point just because its incoming edges are not API calls.",
			nodes: [
				{ id: "webview", kind: "group", label: "Webview" },
				{ id: "board", kind: "component", label: "Board" },
				{ id: "canvas", kind: "component", label: "Canvas", parentId: "webview" },
				{ id: "layout", kind: "component", label: "Layout", parentId: "webview" },
			],
			edges: [
				{ id: "incoming", kind, source: "board", target: "canvas" },
				{ id: "arrange", kind: "api_call", source: "canvas", target: "layout" },
			],
		}
		const dimensions = Object.fromEntries(diagram.nodes.map((node) => [node.id, { width: 248, height: 110 }]))
		const elk = new ELK()
		for (const options of [{}, { wrapGroups: true }, { wrapGroups: true, wrapRoot: false }]) {
			const graph = toElkGraph({ diagram, dimensions }, options)
			const canvas = graph.children!.find((node) => node.id === "node:webview")!.children![0]
			expect(canvas.layoutOptions).not.toHaveProperty("elk.layered.layering.layerConstraint")
			const result = fromElkGraph(await elk.layout(graph))
			expect(Object.keys(result.positions).sort()).toEqual(diagram.nodes.map((node) => node.id).sort())
			expect(Object.keys(result.routes).sort()).toEqual(diagram.edges.map((edge) => edge.id).sort())
		}
	}, 10_000)
	it("reserves FIRST for entry callers, excluding return cycles and self-links", () => {
		const diagram: ArchitectureDiagram = {
			title: "Entry callers",
			summary: "Only callers with no incoming relationships can have a hard FIRST constraint.",
			nodes: ["entry", "caller", "worker", "self"].map((id) => ({ id, kind: "component", label: id })),
			edges: [
				{ id: "entry-call", kind: "api_call", source: "entry", target: "worker" },
				{ id: "call", kind: "api_call", source: "caller", target: "worker" },
				{ id: "return", kind: "data_flow", source: "worker", target: "caller" },
				{ id: "self-call", kind: "api_call", source: "self", target: "worker" },
				{ id: "self-link", kind: "dependency", source: "self", target: "self" },
			],
		}
		const dimensions = Object.fromEntries(diagram.nodes.map((node) => [node.id, { width: 248, height: 110 }]))
		const graph = toElkGraph({ diagram, dimensions })
		const first = graph.children!.filter((node) => node.layoutOptions?.["elk.layered.layering.layerConstraint"] === "FIRST")
		expect(first.map((node) => node.id)).toEqual(["node:entry"])
	})
	it("canonicalizes sub-pixel ELK coordinate noise without straightening real diagonals", () => {
		const result = fromElkGraph({
			id: "root",
			edges: [
				{
					id: "edge:horizontal",
					sources: ["a"],
					targets: ["b"],
					sections: [
						{
							id: "h",
							startPoint: { x: 10, y: 400.3333333333333 },
							endPoint: { x: 200, y: 400.33333333333326 },
						},
					],
				},
				{
					id: "edge:diagonal",
					sources: ["a"],
					targets: ["b"],
					sections: [
						{
							id: "d",
							startPoint: { x: 10, y: 400.3333333333333 },
							endPoint: { x: 200, y: 401.33333333333326 },
						},
					],
				},
			],
		})
		expect(result.routes.horizontal[0].y).toBe(result.routes.horizontal[1].y)
		expect(result.routes.horizontal[0].y).toBeCloseTo(400.3333333333333, 6)
		expect(result.routes.diagonal[0].y).not.toBe(result.routes.diagonal[1].y)
	})
	it("rejects oversized graphs and missing/invalid measurements before scheduling a worker", () => {
		expect(() => toElkGraph({ diagram: { ...diagram, nodes: Array(501).fill(diagram.nodes[0]) }, dimensions })).toThrow(
			/limits/,
		)
		expect(() => toElkGraph({ diagram: { ...diagram, edges: Array(2001).fill(diagram.edges[0]) }, dimensions })).toThrow(
			/limits/,
		)
		expect(() => toElkGraph({ diagram, dimensions: {} })).toThrow(/measured/)
		expect(() => toElkGraph({ diagram, dimensions: { ...dimensions, core: { width: Infinity, height: 10 } } })).toThrow(
			/measured/,
		)
		expect(() => fromElkGraph({ id: "root", children: [{ id: "bad", x: NaN, y: 0, width: 1, height: 1 }] })).toThrow(
			/invalid/,
		)
	})
})
