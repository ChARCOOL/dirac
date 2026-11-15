import { describe, expect, it } from "vitest"
import type { ArchitectureDiagram } from "@shared/architecture"
import { GROUP_MIN_SIZE, toElkGraph, type LayoutInput, type LayoutOutput } from "./layoutGraph"
import { allocateLayoutSpace, FIT_PADDING, layoutAspectRatio, measureComposition, PREFERRED_ASPECT_RATIO } from "./layoutSpace"

const diagram: ArchitectureDiagram = {
	title: "Two subsystems",
	summary: "",
	nodes: [
		{ id: "left", kind: "group", label: "Left" },
		{ id: "nested", kind: "group", label: "Nested", parentId: "left" },
		{ id: "a", kind: "component", label: "A", parentId: "nested" },
		{ id: "b", kind: "component", label: "B", parentId: "left" },
		{ id: "right", kind: "group", label: "Right" },
		{ id: "c", kind: "component", label: "C", parentId: "right" },
	],
	edges: [],
}
const input: LayoutInput = {
	diagram,
	dimensions: Object.fromEntries(diagram.nodes.map((node) => [node.id, { width: 248, height: 96 }])),
	canvas: { width: 1600, height: 1000 },
}

const pair: ArchitectureDiagram = {
	title: "Pair",
	summary: "",
	nodes: ["a", "b"].map((id) => ({ id, kind: "component", label: id })),
	edges: [],
}
function separatedBy(gap: number): LayoutOutput {
	return {
		positions: { a: { x: 0, y: 0 }, b: { x: 248 + gap, y: 0 } },
		sizes: { a: { width: 248, height: 96 }, b: { width: 248, height: 96 } },
		routes: {},
	}
}

describe("Canvas space allocation", () => {
	it("keeps the legacy policy when there is no canvas", () => {
		const headless = { ...input, canvas: undefined }
		expect(allocateLayoutSpace(headless)).toBeUndefined()
		expect(layoutAspectRatio(headless)).toBe(PREFERRED_ASPECT_RATIO)
	})

	it("allocates subsystem shares from descendant cards, not expanded frame sizes", () => {
		const space = allocateLayoutSpace(input)!
		expect(space.aspectRatio).toBeCloseTo(1.6)
		expect(space.groupAspectRatios.get("left")).toBeCloseTo((1.6 * 2) / 3)
		expect(space.groupAspectRatios.get("right")).toBeCloseTo(1.6 / 3)
		expect(space.groupAspectRatios.get("nested")).toBeCloseTo(1.6 / 3)
		const dimensions = { ...input.dimensions, left: { width: 4000, height: 3000 } }
		expect(allocateLayoutSpace({ ...input, dimensions })).toEqual(space)
	})

	it("spends surplus area on bounded gaps without changing measured cards", () => {
		const small = allocateLayoutSpace({ ...input, canvas: { width: 600, height: 400 } })!
		const large = allocateLayoutSpace({ ...input, canvas: { width: 2000, height: 1200 } })!
		const huge = allocateLayoutSpace({ ...input, canvas: { width: 20000, height: 12000 } })!
		expect(large.nodeGap).toBeGreaterThan(small.nodeGap)
		expect(large.layerGap).toBeGreaterThan(small.layerGap)
		expect(huge.nodeGap).toBe(large.nodeGap)
		expect(huge.layerGap).toBe(large.layerGap)
		const graph = toElkGraph(input, { wrapGroups: true, partitionGroups: true })
		const left = graph.children!.find((node) => node.id === "node:left")!
		expect(left.layoutOptions!["elk.spacing.nodeNode"]).toBe(graph.layoutOptions!["elk.spacing.nodeNode"])
		expect(Number(left.layoutOptions!["elk.aspectRatio"])).toBeCloseTo((1.6 * 2) / 3)
		expect(left).toMatchObject(GROUP_MIN_SIZE)
		expect(left.children!.find((node) => node.id === "node:b")).toMatchObject(input.dimensions.b)
	})

	it("uses the actual pane aspect ratio in both landscape and portrait", () => {
		for (const canvas of [
			{ width: 2400, height: 1000 },
			{ width: 600, height: 1000 },
		]) {
			const request = { ...input, canvas }
			expect(layoutAspectRatio(request)).toBe(canvas.width / canvas.height)
			expect(Number(toElkGraph(request).layoutOptions!["elk.aspectRatio"])).toBe(canvas.width / canvas.height)
		}
	})

	it("handles empty graphs and rejects invalid canvas dimensions", () => {
		const empty = { ...input, diagram: { ...diagram, nodes: [], edges: [] }, dimensions: {} }
		expect(allocateLayoutSpace(empty)!.groupAspectRatios.size).toBe(0)
		for (const width of [0, -1, Infinity, NaN]) {
			expect(() => allocateLayoutSpace({ ...input, canvas: { width, height: 1000 } })).toThrow(/positive canvas/)
		}
	})
})

describe("Screen-space composition", () => {
	const canvas = { width: 1000, height: 700 }
	it("prefers breathing room but not arbitrarily long, unreadable drawings", () => {
		const cramped = measureComposition(pair, separatedBy(8), canvas)
		const roomy = measureComposition(pair, separatedBy(96), canvas)
		const stretched = measureComposition(pair, separatedBy(4000), canvas)
		expect(roomy.crowding).toBe(0)
		expect(roomy.cost).toBeLessThan(cramped.cost)
		expect(roomy.cost).toBeLessThan(stretched.cost)
		expect(roomy.zoom).toBeGreaterThan(stretched.zoom)
	})

	it("includes route excursions and predicts the same padding as Fit", () => {
		const layout = separatedBy(96)
		layout.routes.detour = [
			{ x: 0, y: 48 },
			{ x: 2000, y: 48 },
		]
		expect(measureComposition(pair, layout, canvas).zoom).toBeCloseTo(canvas.width / (1 + 2 * FIT_PADDING) / 2000)
	})

	it("returns finite metrics for empty graphs and group-only diagrams", () => {
		expect(measureComposition({ ...pair, nodes: [] }, { positions: {}, sizes: {}, routes: {} }, canvas)).toEqual({
			zoom: 1,
			crowding: 0,
			unused: 0,
			cost: 0,
		})
		const group: ArchitectureDiagram = { ...pair, nodes: [{ id: "g", kind: "group", label: "G" }] }
		const result = measureComposition(
			group,
			{ positions: { g: { x: 0, y: 0 } }, sizes: { g: GROUP_MIN_SIZE }, routes: {} },
			canvas,
		)
		expect(result.crowding).toBe(0)
		expect(Number.isFinite(result.cost)).toBe(true)
	})
})
