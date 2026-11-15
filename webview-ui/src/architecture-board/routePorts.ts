import type { ArchitectureDiagram, ArchitectureEdge, ArchitecturePosition as Point, NodeKind } from "@shared/architecture"
import type { LayoutOutput } from "./layoutGraph"
import { planLineJumps } from "./lineJumps"
import { direction, routeDistanceLowerBound, shortestOrthogonalRoute } from "./orthogonalRouter"
import { groupPortSide, portSpan, shapePort, terminalSide, type PortSide } from "./nodeShapes"
import type { NodeGeometry } from "./styles/types"
import {
	absoluteBoxes,
	EPSILON,
	hitsBox,
	normalizeRoute,
	routeLength,
	routeObstacles,
	segmentContact,
	segments,
	type Box,
} from "./routeGeometry"

interface Terminal {
	point: Point
	stub: Point
	side: PortSide
}
const SIDES: PortSide[] = ["left", "right", "top", "bottom"]
const MAX_PORT_CHECKS = 600_000
const MAX_PROBE_CHECKS = 4_000
const MAX_EDGE_CHECKS = 40_000

function envelopeTerminal(point: Point, side: PortSide, box: Box, length = 12): Terminal {
	const horizontal = side === "left" || side === "right"
	const boundary = {
		x: horizontal ? (side === "left" ? box.x : box.x + box.width) : point.x,
		y: horizontal ? point.y : side === "top" ? box.y : box.y + box.height,
	}
	return {
		point: boundary,
		side,
		stub: {
			x: boundary.x + (horizontal ? (side === "left" ? -length : length) : 0),
			y: boundary.y + (!horizontal ? (side === "top" ? -length : length) : 0),
		},
	}
}

/** Route recovery starts from envelope ports; SVG docking is a final, reversible projection. */
export function envelopeRoutes(diagram: ArchitectureDiagram, layout: LayoutOutput): Record<string, Point[]> {
	const boxes = new Map(absoluteBoxes(diagram, layout).map((box) => [box.id, box]))
	return Object.fromEntries(
		diagram.edges.map((edge) => {
			const route = [...layout.routes[edge.id]]
			for (const [id, index, next] of [
				[edge.source, 0, 1],
				[edge.target, route.length - 1, route.length - 2],
			] as const) {
				const box = boxes.get(id)!
				const side = box.group ? groupPortSide(route[index], route[next], box) : terminalSide(route[index], route[next])
				route[index] = envelopeTerminal(route[index], side, box).point
			}
			return [edge.id, normalizeRoute(route)]
		}),
	)
}

function dockedPoint(point: Point, adjacent: Point, box: Box, kind: NodeKind, geometry?: NodeGeometry): Point {
	const side = box.group ? groupPortSide(point, adjacent, box) : terminalSide(point, adjacent)
	const offset = side === "top" || side === "bottom" ? point.x - box.x : point.y - box.y
	const projected = shapePort(kind, box, side, offset, geometry)
	return side === "top" || side === "bottom" ? { x: point.x, y: box.y + projected.y } : { x: box.x + projected.x, y: point.y }
}

export function dockShapeRoutes(diagram: ArchitectureDiagram, layout: LayoutOutput, geometry?: NodeGeometry): LayoutOutput {
	const boxes = new Map(absoluteBoxes(diagram, layout).map((box) => [box.id, box]))
	const kinds = new Map(diagram.nodes.map((node) => [node.id, node.kind]))
	const routes = Object.fromEntries(
		diagram.edges.map((edge) => {
			const route = [...layout.routes[edge.id]]
			for (const [id, index, next] of [
				[edge.source, 0, 1],
				[edge.target, route.length - 1, route.length - 2],
			] as const) {
				const box = boxes.get(id)!
				route[index] = dockedPoint(route[index], route[next], box, kinds.get(id)!, geometry)
			}
			return [edge.id, normalizeRoute(route)]
		}),
	)
	return { ...layout, routes }
}

function terminalCandidates(
	id: string,
	kind: NodeKind,
	box: Box,
	other: Box,
	seed: Point,
	adjacent: Point,
	edge: ArchitectureEdge,
	diagram: ArchitectureDiagram,
	routes: Record<string, Point[]>,
	geometry?: NodeGeometry,
): Terminal[] {
	const originalSide = terminalSide(seed, adjacent)
	const original = envelopeTerminal(seed, originalSide, box, Math.min(12, routeLength([seed, adjacent])))
	const occupied = diagram.edges
		.filter((item) => item.id !== edge.id)
		.flatMap((item) => {
			const route = routes[item.id]
			const result: { point: Point; side: PortSide }[] = []
			if (item.source === id) result.push({ point: route[0], side: terminalSide(route[0], route[1]) })
			if (item.target === id) result.push({ point: route.at(-1)!, side: terminalSide(route.at(-1)!, route.at(-2)!) })
			return result
		})
	const choices = [original]
	for (const side of SIDES) {
		const horizontal = side === "top" || side === "bottom"
		const [min, max] = portSpan(kind, side, box, geometry)
		const origin = horizontal ? box.x : box.y
		const wanted = horizontal ? other.x + other.width / 2 - origin : other.y + other.height / 2 - origin
		const offsets = [Math.max(min, Math.min(max, wanted)), (min + max) / 2]
		for (let offset = min; offset <= max; offset += 12) offsets.push(offset)
		offsets.sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b)
		const offset = offsets.find(
			(value) =>
				!occupied.some(
					(port) =>
						port.side === side &&
						Math.abs((horizontal ? port.point.x : port.point.y) - origin - value) < 12 - EPSILON,
				),
		)
		if (offset === undefined) continue
		const point = { x: horizontal ? box.x + offset : box.x, y: horizontal ? box.y : box.y + offset }
		const candidate = envelopeTerminal(point, side, box)
		if (routeLength([candidate.point, original.point]) > EPSILON) choices.push(candidate)
	}
	return choices
}

/** A bounded improvement pass, never a fallback: only shorter, fully checked alternatives are committed.
 * Side choice is geometric, not semantic: targets can receive arrows on any side. */
export function optimizeRoutePorts(
	diagram: ArchitectureDiagram,
	layout: LayoutOutput,
	geometry?: NodeGeometry,
): { layout: LayoutOutput; checks: number; changed: string[] } {
	const boxes = absoluteBoxes(diagram, layout)
	const kinds = new Map(diagram.nodes.map((node) => [node.id, node.kind]))
	let routes = { ...layout.routes }
	let checks = 0
	const changed: string[] = []
	const edges = [...diagram.edges].sort(
		(a, b) => routeLength(routes[b.id]) - routeLength(routes[a.id]) || a.id.localeCompare(b.id),
	)
	for (const edge of edges) {
		if (checks >= MAX_PORT_CHECKS) break
		const source = boxes.find((box) => box.id === edge.source)!
		const target = boxes.find((box) => box.id === edge.target)!
		if (source.group || target.group || edge.source === edge.target || routeLength(routes[edge.id]) <= 24) continue
		const seed = routes[edge.id]
		const edgeLimit = Math.min(MAX_PORT_CHECKS, checks + MAX_EDGE_CHECKS)
		const visibleLength = (route: Point[]) =>
			routeLength(route) +
			routeLength([route[0], dockedPoint(route[0], route[1], source, kinds.get(edge.source)!, geometry)]) +
			routeLength([route.at(-1)!, dockedPoint(route.at(-1)!, route.at(-2)!, target, kinds.get(edge.target)!, geometry)])
		const starts = terminalCandidates(
			edge.source,
			kinds.get(edge.source)!,
			source,
			target,
			seed[0],
			seed[1],
			edge,
			diagram,
			routes,
			geometry,
		)
		const ends = terminalCandidates(
			edge.target,
			kinds.get(edge.target)!,
			target,
			source,
			seed.at(-1)!,
			seed.at(-2)!,
			edge,
			diagram,
			routes,
			geometry,
		)
		// A longer straight approach can bridge a nearby outgoing lane before entering the node.
		starts.push(...starts.map((port) => envelopeTerminal(port.point, port.side, source, 24)))
		ends.push(...ends.map((port) => envelopeTerminal(port.point, port.side, target, 24)))
		const obstacles = routeObstacles(edge, boxes)
		const pairs = starts.flatMap((start) =>
			ends.map((end) => ({
				start,
				end,
				bound:
					visibleLength([start.point, start.stub, end.stub, end.point]) +
					routeDistanceLowerBound(start.stub, end.stub, obstacles) -
					routeLength([start.stub, end.stub]),
			})),
		)
		pairs.sort((a, b) => a.bound - b.bound)
		// Try distinct side pairs before spending the edge's allowance on alternate
		// slots/stub lengths for the same sides. Bounds order candidates within a round.
		const counts = new Map<string, number>()
		const probes = pairs
			.map((pair) => {
				const key = `${pair.start.side}:${pair.end.side}`
				const round = counts.get(key) ?? 0
				counts.set(key, round + 1)
				return { ...pair, round }
			})
			.sort((a, b) => a.round - b.round || a.bound - b.bound)
		const lanes = Object.entries(routes)
			.filter(([id]) => id !== edge.id)
			.flatMap(([, route]) => segments(route))
		for (const { start, end, bound } of probes) {
			if (checks >= edgeLimit) break
			if (bound > visibleLength(routes[edge.id]) + EPSILON) continue
			if (
				obstacles.some(
					(box) =>
						(box.id !== edge.source && hitsBox([start.point, start.stub], box, 8)) ||
						(box.id !== edge.target && hitsBox([end.stub, end.point], box, 8)),
				)
			)
				continue
			const budget = { checks: 0, exhausted: false, limit: Math.min(MAX_PROBE_CHECKS, edgeLimit - checks) }
			const path = shortestOrthogonalRoute(
				start.stub,
				end.stub,
				direction(start.point, start.stub),
				direction(end.stub, end.point),
				obstacles,
				lanes,
				budget,
			)
			checks += budget.checks
			if (!path) continue
			const candidate = normalizeRoute([start.point, ...path, end.point])
			const approaches = [segments(candidate)[0], segments(candidate).at(-1)!]
			if (
				approaches.some((segment) =>
					lanes.some((lane) => {
						const separation =
							segment[0].y === segment[1].y
								? Math.abs(segment[0].y - lane[0].y)
								: Math.abs(segment[0].x - lane[0].x)
						return separation < 4 - EPSILON && segmentContact(segment, lane).overlap > EPSILON
					}),
				)
			)
				continue
			const improvement = visibleLength(routes[edge.id]) - visibleLength(candidate)
			if (improvement < -EPSILON || (improvement < EPSILON && candidate.length >= routes[edge.id].length)) continue
			const next = { ...routes, [edge.id]: candidate }
			const nextLayout = { ...layout, routes: next }
			if (planLineJumps(diagram, nextLayout).issues.length) continue
			// Recessed silhouettes extend terminal runs beyond their envelope ports.
			// Commit only if the actual visible routes can still carry every hop.
			if (planLineJumps(diagram, dockShapeRoutes(diagram, nextLayout, geometry)).issues.length) continue
			routes = next
		}
		if (routes[edge.id] !== seed) changed.push(edge.id)
	}
	return { layout: { ...layout, routes }, checks, changed }
}
