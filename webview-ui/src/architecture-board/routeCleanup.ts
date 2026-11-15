import type { ArchitectureDiagram, ArchitectureEdge, ArchitecturePosition as Point } from "@shared/architecture"
import type { LayoutOutput } from "./layoutGraph"
import { planLineJumps, type CrossingBudget } from "./lineJumps"
import { direction, shortestOrthogonalRoute, type RoutingBudget } from "./orthogonalRouter"
import {
	absoluteBoxes,
	EPSILON,
	GROUP_HEADER_HEIGHT,
	normalizeRoute,
	routeLength,
	routeObstacles,
	samePoint,
	segments,
	type Box,
} from "./routeGeometry"

export interface CleanupMetrics {
	shortcuts: number
	checks: number
	exhausted: boolean
	retained: string[]
	restored: string[]
	unbridged: number
}

function portStub(a: Point, b: Point, box: Box): Point {
	let length = 12
	if (
		box.group &&
		a.x >= box.x &&
		a.x <= box.x + box.width &&
		a.y >= box.y &&
		a.y <= box.y + Math.min(GROUP_HEADER_HEIGHT, box.height)
	) {
		const escape =
			a.y === b.y
				? b.x > a.x
					? box.x + box.width - a.x
					: a.x - box.x
				: b.y > a.y
					? box.y + Math.min(GROUP_HEADER_HEIGHT, box.height) - a.y
					: a.y - box.y
		length = Math.max(length, escape + 8)
	}
	const fraction = Math.min(length / routeLength([a, b]), 1)
	if (fraction === 1) return b
	return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction }
}

function routeEdge(
	edge: ArchitectureEdge,
	seed: Point[],
	boxes: Box[],
	routes: Record<string, Point[]>,
	budget: RoutingBudget,
	extra: Box[] = [],
): Point[] | undefined {
	const first = seed[0]
	const last = seed.at(-1)!
	if (seed.length === 2 && routeLength(seed) <= 24) return [...seed]
	const a = portStub(first, seed[1], boxes.find((box) => box.id === edge.source)!)
	const b = portStub(last, seed.at(-2)!, boxes.find((box) => box.id === edge.target)!)
	if (samePoint(a, b)) return undefined
	const lanes = Object.entries(routes)
		.filter(([id]) => id !== edge.id)
		.flatMap(([, route]) => segments(route))
	const path = shortestOrthogonalRoute(
		a,
		b,
		direction(first, a),
		direction(b, last),
		[...routeObstacles(edge, boxes), ...extra],
		lanes,
		budget,
	)
	return path && normalizeRoute([first, ...path, last])
}

function sharesLane(route: Point[], other: Point[], budget: { checks: number }): boolean {
	for (const [a, b] of segments(route)) {
		for (const [c, d] of segments(other)) {
			if (++budget.checks > 500_000) throw new Error("Route recovery exceeded its lane-check limit")
			const horizontal = a.y === b.y && c.y === d.y && a.y === c.y
			const vertical = a.x === b.x && c.x === d.x && a.x === c.x
			if (!horizontal && !vertical) continue
			const axis = horizontal ? "x" : "y"
			if (
				Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
				Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) >
				EPSILON
			)
				return true
		}
	}
	return false
}

/** Roll back only conflicting relationships, never all routes because one hop failed. */
function restoreConflictingRoutes(
	diagram: ArchitectureDiagram,
	layout: LayoutOutput,
	original: Record<string, Point[]>,
	routes: Record<string, Point[]>,
	planned: ReturnType<typeof planLineJumps>,
	crossingBudget: CrossingBudget,
): ReturnType<typeof planLineJumps> {
	const budget = { checks: 0 }
	// Each changing pass restores at least one route. No route can be restored twice.
	for (let remaining = diagram.edges.length; remaining >= 0; remaining--) {
		const conflicts = new Set(planned.issues.flatMap((issue) => [issue.edge, issue.other]))
		for (const [id, route] of Object.entries(routes)) {
			if (route !== original[id]) continue
			for (const [other, path] of Object.entries(routes)) {
				if (other !== id && path !== original[other] && sharesLane(route, path, budget)) conflicts.add(other)
			}
		}
		let changed = false
		for (const id of conflicts) {
			changed ||= routes[id] !== original[id]
			routes[id] = original[id]
		}
		if (!changed) return planned
		planned = planLineJumps(diagram, { ...layout, routes }, crossingBudget)
	}
	return planned
}

/** Fixed ports + fixed placement; crossings are allowed, parallel runs are separated.
 * Only completed, obstacle-checked searches replace ELK paths. Work limits are explicit. */
export function cleanLayoutRoutes(
	diagram: ArchitectureDiagram,
	layout: LayoutOutput,
	requireRoutes = false,
): {
	layout: LayoutOutput
	metrics: CleanupMetrics
} {
	const boxes = absoluteBoxes(diagram, layout)
	const original = Object.fromEntries(Object.entries(layout.routes).map(([id, route]) => [id, normalizeRoute(route)]))
	const routes: Record<string, Point[]> = {}
	const budget: RoutingBudget = { checks: 0, exhausted: false }
	const retained: string[] = []
	// Reserve short local connections first; long relationships can cross them with hops.
	const edges = [...diagram.edges].sort(
		(a, b) => routeLength(original[a.id]) - routeLength(original[b.id]) || a.id.localeCompare(b.id),
	)
	for (const edge of edges) {
		const path = budget.exhausted ? undefined : routeEdge(edge, original[edge.id], boxes, routes, budget)
		if (!path && requireRoutes)
			throw new Error(`Cannot route ${edge.id} at these positions. Move overlapping cards apart or choose Redraw.`)
		if (!path) retained.push(edge.id)
		routes[edge.id] = path ?? original[edge.id]
	}
	// Repair/rollback passes share one allowance rather than restarting a costly scan.
	const crossingBudget: CrossingBudget = { checks: 0 }
	let planned = planLineJumps(diagram, { ...layout, routes }, crossingBudget)
	// A crossing too close to a corner/port cannot carry a readable hop. Reroute locally
	// around that contact, rather than forbidding all crossings or silently omitting it.
	const exclusions = new Map<string, Box[]>()
	for (let pass = 0; pass < 4 && planned.issues.length && !budget.exhausted; pass++) {
		for (const issue of planned.issues) {
			const extra = exclusions.get(issue.edge) ?? []
			extra.push({
				id: "crossing",
				x: issue.point.x - 4,
				y: issue.point.y - 4,
				width: 8,
				height: 8,
				ancestors: [],
				group: false,
			})
			exclusions.set(issue.edge, extra)
		}
		for (const [id, extra] of exclusions) {
			const edge = edges.find((edge) => edge.id === id)!
			const path = routeEdge(edge, original[id], boxes, routes, budget, extra)
			if (path) routes[id] = path
		}
		planned = planLineJumps(diagram, { ...layout, routes }, crossingBudget)
	}
	if (!requireRoutes && planned.issues.length)
		planned = restoreConflictingRoutes(diagram, layout, original, routes, planned, crossingBudget)
	if (requireRoutes && planned.issues.length)
		throw new Error("Not enough room for relationship hops. Move nearby cards apart or choose Redraw.")
	return {
		layout: { ...layout, routes, decorations: planned.decorations },
		metrics: {
			shortcuts: edges.filter((edge) => routeLength(routes[edge.id]) < routeLength(original[edge.id]) - EPSILON).length,
			...budget,
			retained,
			restored: edges
				.filter((edge) => routes[edge.id] === original[edge.id] && !retained.includes(edge.id))
				.map((edge) => edge.id),
			unbridged: planned.issues.length,
		},
	}
}
