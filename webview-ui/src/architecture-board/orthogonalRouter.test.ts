import { describe, expect, it } from "vitest"
import { routeDistanceLowerBound, shortestOrthogonalRoute, type RoutingBudget } from "./orthogonalRouter"
import { hitsBox, routeLength, segments, type Box, type Segment } from "./routeGeometry"

const budget = (): RoutingBudget => ({ checks: 0, exhausted: false })

describe("Hop-aware orthogonal search", () => {
	it("accounts for unavoidable barrier detours without double counting shared obstacles", () => {
		const barrier: Box = { id: "barrier", x: 0, y: 100, width: 1000, height: 64, group: false, ancestors: [] }
		const start = { x: 400, y: 0 }
		const end = { x: 600, y: 300 }
		expect(routeDistanceLowerBound(start, end, [barrier])).toBe(1316)
		expect(routeDistanceLowerBound(end, start, [barrier, { ...barrier, id: "same" }])).toBe(1316)
		expect(routeDistanceLowerBound(start, { x: 400, y: 50 }, [barrier])).toBe(50)
		const rotated = { ...barrier, x: barrier.y, y: barrier.x, width: barrier.height, height: barrier.width }
		expect(routeDistanceLowerBound({ x: 0, y: 400 }, { x: 300, y: 600 }, [rotated])).toBe(1316)
	})
	it("finds the shortest barrier detour despite coordinate noise from distant relationships", () => {
		const barrier: Box = { id: "barrier", x: 0, y: 100, width: 1000, height: 64, group: false, ancestors: [] }
		const lanes: Segment[] = Array.from({ length: 40 }, (_, i) => [
			{ x: 350 + i * 7, y: -1000 - i * 11 },
			{ x: 650 - i * 7, y: -1000 - i * 11 },
		])
		lanes.push(
			...Array.from(
				{ length: 40 },
				(_, i): Segment => [
					{ x: -1000 - i * 11, y: i * 7 },
					{ x: -1000 - i * 11, y: 300 - i * 7 },
				],
			),
		)
		const work = budget()
		const route = shortestOrthogonalRoute({ x: 400, y: 0 }, { x: 600, y: 300 }, 1, 1, [barrier], lanes, work)!
		// The former Manhattan-only search exhausted its separate visit cap here.
		expect(work.exhausted).toBe(false)
		expect(routeLength(route)).toBe(1316)
		expect(segments(route).some((segment) => hitsBox(segment, barrier, 8))).toBe(false)
		expect(work.checks).toBeLessThan(4_000_000)
	})
	it("reports budget exhaustion separately from a completed search with no route", () => {
		const barrier: Box = { id: "barrier", x: 40, y: -20, width: 20, height: 40, group: false, ancestors: [] }
		const work = { ...budget(), limit: 1 }
		expect(shortestOrthogonalRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 0, [barrier], [], work)).toBeUndefined()
		expect(work).toMatchObject({ checks: 1, exhausted: true })
		const blocked = budget()
		expect(shortestOrthogonalRoute({ x: 50, y: 0 }, { x: 100, y: 0 }, 0, 0, [barrier], [], blocked)).toBeUndefined()
		expect(blocked.exhausted).toBe(false)
	})
	it("allows a direct perpendicular crossing with straight space on both lines", () => {
		const route = shortestOrthogonalRoute(
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			0,
			0,
			[],
			[
				[
					{ x: 50, y: -50 },
					{ x: 50, y: 50 },
				],
			],
			budget(),
		)!
		expect(route).toEqual([
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		])
	})
	it("does not put an elbow four pixels after a crossing", () => {
		const lane: Segment = [
			{ x: 50, y: -40 },
			{ x: 50, y: 80 },
		]
		const work = budget()
		const route = shortestOrthogonalRoute({ x: 0, y: 0 }, { x: 54, y: 100 }, 0, 1, [], [lane], work)!
		expect(work.exhausted).toBe(false)
		expect(routeLength(route)).toBe(154)
		for (const point of route.slice(1, -1)) {
			expect(
				hitsBox(lane, {
					id: "corner",
					x: point.x - 8,
					y: point.y - 8,
					width: 16,
					height: 16,
					ancestors: [],
					group: false,
				}),
			).toBe(false)
		}
	})
	it("routes around an existing corner's clearance without wrapping the whole drawing", () => {
		const route = shortestOrthogonalRoute(
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			0,
			0,
			[],
			[
				[
					{ x: 50, y: -40 },
					{ x: 50, y: 4 },
				],
				[
					{ x: 50, y: 4 },
					{ x: 80, y: 4 },
				],
			],
			budget(),
		)!
		expect(routeLength(route)).toBeGreaterThan(100)
		expect(routeLength(route)).toBeLessThan(200)
		expect(segments(route).every(([a, b]) => a.x === b.x || a.y === b.y)).toBe(true)
	})
})
