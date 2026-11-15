import { describe, expect, it } from "vitest"
import type { ArchitectureDiagram, ArchitecturePosition as Point } from "@shared/architecture"
import { cleanLayoutRoutes } from "./routeCleanup"
import { MAX_ROUTE_CHECKS } from "./orthogonalRouter"
import { absoluteBoxes, hitsBox, normalizeRoute, routeLength, routeObstacles, segmentContact, segments } from "./routeGeometry"
import { measureLayout } from "./layoutQuality"
import type { LayoutOutput } from "./layoutGraph"

const points = (...coordinates: number[]): Point[] =>
	Array.from({ length: coordinates.length / 2 }, (_, i) => ({ x: coordinates[i * 2], y: coordinates[i * 2 + 1] }))
const diagram: ArchitectureDiagram = {
	title: "Routes",
	summary: "",
	nodes: ["a", "b"].map((id) => ({ id, kind: "component", label: id })),
	edges: [{ id: "e", source: "a", target: "b", kind: "api_call" }],
}
const layout: LayoutOutput = {
	positions: { a: { x: 0, y: 80 }, b: { x: 200, y: 80 } },
	sizes: { a: { width: 40, height: 40 }, b: { width: 40, height: 40 } },
	routes: { e: points(40, 100, 60, 100, 60, 20, 180, 20, 180, 100, 200, 100) },
}

function contactCount(a: Point[], b: Point[]) {
	return segments(a)
		.flatMap((segment) => segments(b).map((other) => segmentContact(segment, other)))
		.reduce((sum, contact) => ({ crossings: sum.crossings + contact.crossings, overlap: sum.overlap + contact.overlap }), {
			crossings: 0,
			overlap: 0,
		})
}

describe("Bounded obstacle-aware route cleanup", () => {
	it("normalizes redundant points without erasing reversals or self loops", () => {
		expect(normalizeRoute(points(0, 0, 0, 0, 10, 0, 20, 0, 20, 10))).toEqual(points(0, 0, 20, 0, 20, 10))
		expect(normalizeRoute(points(0, 0, 20, 0, 10, 0))).toEqual(points(0, 0, 20, 0, 10, 0))
	})
	it("removes a safe hairpin without changing node placement, endpoint direction or input", () => {
		const snapshot = structuredClone(layout)
		const result = cleanLayoutRoutes(diagram, layout)
		expect(result.layout.routes.e).toEqual(points(40, 100, 200, 100))
		expect(result.layout.positions).toBe(layout.positions)
		expect(result.layout.sizes).toBe(layout.sizes)
		expect(result.metrics.shortcuts).toBe(1)
		expect(layout).toEqual(snapshot)
		expect(measureLayout(diagram, result.layout).invalid).toBeUndefined()
	})
	it("keeps a short straight connector instead of making overlapping port stubs detour", () => {
		const source = {
			...layout,
			positions: { ...layout.positions, b: { x: 60, y: 80 } },
			routes: { e: points(40, 100, 60, 100) },
		}
		const result = cleanLayoutRoutes(diagram, source)
		expect(result.layout.routes.e).toEqual(source.routes.e)
		expect(result.metrics.restored).toEqual([])
	})
	it("aligns numerical grid noise before removing a tiny bend", () => {
		const route = normalizeRoute(points(0, 0, 10, 0, 10, 0.0000003, 10, 40, 100, 40))
		expect(route).toEqual(points(0, 0, 10, 0, 10, 40, 100, 40))
		expect(segments(route).every(([a, b]) => a.x === b.x || a.y === b.y)).toBe(true)
	})
	it("retains a detour when the direct shortcut would enter a node or its clearance", () => {
		const blocked: ArchitectureDiagram = {
			...diagram,
			nodes: [...diagram.nodes, { id: "wall", kind: "component", label: "Wall" }],
		}
		const occupied: LayoutOutput = {
			...layout,
			positions: { ...layout.positions, wall: { x: 90, y: 70 } },
			sizes: { ...layout.sizes, wall: { width: 60, height: 60 } },
		}
		const result = cleanLayoutRoutes(blocked, occupied).layout
		const wall = absoluteBoxes(blocked, occupied).find((box) => box.id === "wall")!
		expect(routeLength(result.routes.e)).toBeGreaterThan(160)
		expect(segments(result.routes.e).some((segment) => hitsBox(segment, wall, 8))).toBe(false)
		expect(measureLayout(blocked, result).invalid).toBeUndefined()
	})
	it("takes the direct path across another relationship and marks one curved hop", () => {
		const other: ArchitectureDiagram = {
			...diagram,
			nodes: [...diagram.nodes, { id: "c", kind: "component", label: "C" }, { id: "d", kind: "component", label: "D" }],
			edges: [...diagram.edges, { id: "fixed", source: "c", target: "d", kind: "data_flow" }],
		}
		const crossing: LayoutOutput = {
			...layout,
			positions: { ...layout.positions, c: { x: 80, y: 30 }, d: { x: 80, y: 160 } },
			sizes: { ...layout.sizes, c: { width: 40, height: 40 }, d: { width: 40, height: 40 } },
			routes: { ...layout.routes, fixed: points(100, 70, 100, 160) },
		}
		const result = cleanLayoutRoutes(other, crossing).layout
		expect(contactCount(result.routes.e, result.routes.fixed)).toEqual({ crossings: 1, overlap: 0 })
		expect(routeLength(result.routes.e)).toBe(160)
		expect(result.decorations!.e.jumps).toHaveLength(1)
		expect(result.decorations!.fixed.gaps).toHaveLength(1)
	})
	it("keeps parallel ports distinct and preserves self-loop endpoints and clearance", () => {
		const parallel: ArchitectureDiagram = {
			...diagram,
			edges: [
				...diagram.edges,
				{ ...diagram.edges[0], id: "parallel" },
				{ id: "self", source: "a", target: "a", kind: "api_call" },
			],
		}
		const source: LayoutOutput = {
			...layout,
			routes: {
				...layout.routes,
				parallel: points(40, 110, 70, 110, 70, 160, 170, 160, 170, 110, 200, 110),
				self: points(40, 90, 52, 90, 52, 140, 20, 140, 20, 120),
			},
		}
		const result = cleanLayoutRoutes(parallel, source).layout
		for (const id of Object.keys(source.routes)) {
			expect(result.routes[id][0]).toEqual(source.routes[id][0])
			expect(result.routes[id].at(-1)).toEqual(source.routes[id].at(-1))
		}
		expect(result.routes.e).not.toEqual(result.routes.parallel)
		expect(routeLength(result.routes.self)).toBeGreaterThan(0)
		expect(measureLayout(parallel, result).invalid).toBeUndefined()
	})
	it("blocks unrelated group interiors and nested title bands, but permits ancestor interiors", () => {
		const grouped: ArchitectureDiagram = {
			...diagram,
			nodes: [
				{ id: "outer", kind: "group", label: "Outer" },
				{ id: "inner", kind: "group", label: "Inner", parentId: "outer" },
				{ ...diagram.nodes[0], parentId: "inner" },
				{ ...diagram.nodes[1], parentId: "outer" },
				{ id: "unrelated", kind: "group", label: "Other" },
			],
		}
		const groupedLayout: LayoutOutput = {
			...layout,
			positions: { ...layout.positions, outer: { x: 10, y: 20 }, inner: { x: 30, y: 80 }, unrelated: { x: 500, y: 0 } },
			sizes: {
				...layout.sizes,
				outer: { width: 400, height: 500 },
				inner: { width: 120, height: 220 },
				unrelated: { width: 200, height: 300 },
			},
		}
		const boxes = absoluteBoxes(grouped, groupedLayout)
		expect(boxes.find((box) => box.id === "a")).toMatchObject({ x: 40, y: 180, ancestors: ["outer", "inner"] })
		const obstacles = routeObstacles(grouped.edges[0], boxes)
		expect(obstacles.find((box) => box.id === "outer")?.height).toBe(64)
		expect(obstacles.find((box) => box.id === "inner")?.height).toBe(64)
		expect(obstacles.find((box) => box.id === "unrelated")?.height).toBe(300)
	})
	it("bounds geometry work deterministically and never alters positions", () => {
		const large: ArchitectureDiagram = {
			...diagram,
			edges: Array.from({ length: 200 }, (_, i) => ({ ...diagram.edges[0], id: `e${i}` })),
		}
		const source = { ...layout, routes: Object.fromEntries(large.edges.map((edge) => [edge.id, layout.routes.e])) }
		const result = cleanLayoutRoutes(large, source)
		expect(result.metrics.checks).toBeLessThanOrEqual(MAX_ROUTE_CHECKS)
		expect(result.layout.positions).toBe(layout.positions)
		expect(cleanLayoutRoutes(large, source)).toEqual(result)
	})
})
