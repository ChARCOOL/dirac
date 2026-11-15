import { describe, expect, it } from "vitest"
import type { ArchitectureDiagram, ArchitecturePosition as Point } from "@shared/architecture"
import type { LayoutOutput } from "./layoutGraph"
import { MAX_INTERSECTION_CHECKS, planLineJumps } from "./lineJumps"
import type { RouteJumps } from "./lineJumpTypes"
import { roundedRoute } from "./edgeGeometry"

const points = (...values: number[]): Point[] =>
	Array.from({ length: values.length / 2 }, (_, i) => ({ x: values[i * 2], y: values[i * 2 + 1] }))
function crossing(routes: Record<string, Point[]>) {
	const diagram: ArchitectureDiagram = {
		title: "Crossings",
		summary: "",
		nodes: [
			{ id: "a", kind: "component", label: "A" },
			{ id: "b", kind: "component", label: "B" },
		],
		edges: Object.keys(routes).map((id) => ({ id, kind: "data_flow", source: "a", target: "b" })),
	}
	// The crossing planner is independent of endpoint validation; isolate free-space geometry.
	const layout: LayoutOutput = {
		positions: { a: { x: -1000, y: -1000 }, b: { x: 1000, y: 1000 } },
		sizes: { a: { width: 10, height: 10 }, b: { width: 10, height: 10 } },
		routes,
	}
	return { diagram, layout, ...planLineJumps(diagram, layout) }
}

describe("Curved line jumps", () => {
	it("assigns exactly one stable owner and one real under-line gap", () => {
		const routes = { h: points(0, 100, 200, 100), v: points(100, 0, 100, 200) }
		const result = crossing(routes)
		expect(result.issues).toEqual([])
		expect(result.decorations.h.jumps).toHaveLength(1)
		expect(result.decorations.v.jumps).toEqual([])
		expect(result.decorations.v.gaps).toHaveLength(1)
		expect(crossing({ v: routes.v, h: routes.h }).decorations).toEqual(result.decorations)
		const over = roundedRoute(routes.h, result.decorations.h)
		const under = roundedRoute(routes.v, result.decorations.v)
		expect(over.path).toContain(" A 6 6 0 0 1 ")
		expect(under.path.match(/M /g)).toHaveLength(2)
		expect(under.interactionPath).toBe("M 100 0 L 100 200")
		expect(over.label.x).not.toBe(100)
	})
	it("combines adjacent crossings into one elongated hop", () => {
		const result = crossing({ h: points(0, 100, 200, 100), a: points(96, 0, 96, 200), b: points(104, 0, 104, 200) })
		expect(result.issues).toEqual([])
		expect(result.decorations.h.jumps).toHaveLength(1)
		expect(result.decorations.h.jumps[0]).toMatchObject({ from: 96, to: 104 })
		expect(result.decorations.a.gaps).toHaveLength(1)
		expect(result.decorations.b.gaps).toHaveLength(1)
	})
	it("never treats a shared terminal or parallel lane as a crossing", () => {
		const result = crossing({ a: points(0, 0, 100, 0), b: points(0, 0, 0, 100), c: points(0, 30, 100, 30) })
		// b crosses c at c's terminal: it is not a shared terminal and needs repair.
		expect(result.decorations.a).toEqual({ jumps: [], gaps: [] })
		expect(result.issues).toHaveLength(1)
	})
	it("reports a near-corner crossing for local rerouting instead of drawing an unchecked arc", () => {
		const result = crossing({ h: points(0, 0, 10, 0, 10, 100), v: points(5, -5, 5, 5) })
		expect(result.issues.length).toBeGreaterThan(0)
		expect(result.decorations.h.jumps).toEqual([])
	})
	it("counts obstacle work in a shared allowance rather than only crossing pairs", () => {
		const { diagram, layout } = crossing({ h: points(0, 100, 200, 100), v: points(100, 0, 100, 200) })
		const budget = { checks: MAX_INTERSECTION_CHECKS - 1 }
		expect(() => planLineJumps(diagram, layout, budget)).toThrow(/geometry work limit/)
		expect(budget.checks).toBe(MAX_INTERSECTION_CHECKS + 1)
	})
	it("rejects maximum-size dense crossing geometry with a localized work-limit error", () => {
		const routes = Object.fromEntries(
			Array.from({ length: 2000 }, (_, index) => [
				`edge-${index}`,
				index < 1000 ? points(0, 100, 200, 100) : points(100, 0, 100, 200),
			]),
		)
		expect(() => crossing(routes)).toThrow(/geometry work limit/)
	})
	it.each([
		[points(0, 100, 200, 100), "1"],
		[points(200, 100, 0, 100), "0"],
		[points(100, 0, 100, 200), "0"],
		[points(100, 200, 100, 0), "1"],
	])("renders rotated C arcs in both traversal directions", (route, sweep) => {
		const decorations: RouteJumps = { jumps: [{ segment: 0, from: 100, to: 100, radius: 16, side: -1 }], gaps: [] }
		for (const zoom of [0.05, 0.5, 1, 3]) {
			const radius = Math.min(6 / zoom, 16)
			const result = roundedRoute(route, decorations, zoom)
			expect(result.path).toContain(` A ${radius} ${radius} 0 0 ${sweep} `)
			expect(result.path).not.toMatch(/NaN|Infinity/)
			expect(result.path).toMatch(new RegExp(`^M ${route[0].x} ${route[0].y}`))
			expect(result.path.endsWith(`L ${route.at(-1)!.x} ${route.at(-1)!.y}`)).toBe(true)
		}
	})
})
