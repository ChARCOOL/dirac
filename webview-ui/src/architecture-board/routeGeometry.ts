import type { ArchitectureDiagram, ArchitectureEdge, ArchitecturePosition as Point } from "@shared/architecture"
import type { LayoutOutput } from "./layoutTypes"

export const ROUTE_CLEARANCE = 8
export const GROUP_HEADER_HEIGHT = 64
export const EPSILON = 0.000001
export interface Box {
	id: string
	x: number
	y: number
	width: number
	height: number
	ancestors: string[]
	group: boolean
}
export type Segment = readonly [Point, Point]

export function segments(route: Point[]): Segment[] {
	return route.slice(1).map((point, index) => [route[index], point])
}

export function routeLength(route: Point[]): number {
	return segments(route).reduce((sum, [a, b]) => sum + Math.abs(b.x - a.x) + Math.abs(b.y - a.y), 0)
}

export function samePoint(a: Point, b: Point): boolean {
	return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
}

/** Remove redundant points, but not reversals or a self-loop's return to its origin. */
export function normalizeRoute(route: Point[]): Point[] {
	const result: Point[] = []
	for (const input of route) {
		const previous = result.at(-1)
		// Grid boundaries and canonical ELK ports can differ below EPSILON. Align before
		// dropping tiny segments, or removing their bend can create a diagonal neighbor.
		const point = previous
			? {
					x: Math.abs(input.x - previous.x) < EPSILON ? previous.x : input.x,
					y: Math.abs(input.y - previous.y) < EPSILON ? previous.y : input.y,
				}
			: input
		if (previous && samePoint(previous, point)) continue
		while (result.length >= 2) {
			const a = result[result.length - 2]
			const b = result[result.length - 1]
			const straight =
				(a.x === b.x && b.x === point.x && (b.y - a.y) * (point.y - b.y) >= 0) ||
				(a.y === b.y && b.y === point.y && (b.x - a.x) * (point.x - b.x) >= 0)
			if (!straight) break
			result.pop()
		}
		result.push(point)
	}
	return result
}

export function absoluteBoxes(diagram: ArchitectureDiagram, layout: LayoutOutput): Box[] {
	const nodes = new Map(diagram.nodes.map((node) => [node.id, node]))
	const boxes = new Map<string, Box>()
	const visit = (id: string): Box => {
		const cached = boxes.get(id)
		if (cached) return cached
		const node = nodes.get(id)!
		const parent = node.parentId ? visit(node.parentId) : undefined
		const position = layout.positions[id]
		const box = {
			id,
			x: position.x + (parent?.x ?? 0),
			y: position.y + (parent?.y ?? 0),
			...layout.sizes[id],
			ancestors: parent ? [...parent.ancestors, parent.id] : [],
			group: node.kind === "group",
		}
		boxes.set(id, box)
		return box
	}
	return diagram.nodes.map((node) => visit(node.id))
}

/** Ancestor interiors are traversable; their title bands and unrelated groups are not. */
export function routeObstacles(edge: ArchitectureEdge, boxes: Box[]): Box[] {
	const source = boxes.find((box) => box.id === edge.source)!
	const target = boxes.find((box) => box.id === edge.target)!
	return boxes.map((box) => {
		const terminal = box.id === edge.source || box.id === edge.target
		const related = terminal || source.ancestors.includes(box.id) || target.ancestors.includes(box.id)
		return { ...box, height: box.group && related ? Math.min(GROUP_HEADER_HEIGHT, box.height) : box.height }
	})
}

/** Open rectangle intersection: touching the border is allowed, entering the body is not. */
export function hitsBox([a, b]: Segment, box: Box, clearance = 0): boolean {
	const left = box.x - clearance + EPSILON
	const right = box.x + box.width + clearance - EPSILON
	const top = box.y - clearance + EPSILON
	const bottom = box.y + box.height + clearance - EPSILON
	if (a.y === b.y) return a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right
	return a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
}

/** Contacts with another segment, including corner touches and close parallel runs. */
export function segmentContact([a, b]: Segment, [c, d]: Segment): { crossings: number; overlap: number } {
	const horizontal = a.y === b.y
	if (horizontal === (c.y === d.y)) {
		const distance = horizontal ? Math.abs(a.y - c.y) : Math.abs(a.x - c.x)
		if (distance >= ROUTE_CLEARANCE) return { crossings: 0, overlap: 0 }
		const overlap = horizontal
			? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
			: Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
		return { crossings: 0, overlap: Math.max(0, overlap) }
	}
	const [h1, h2] = horizontal ? [a, b] : [c, d]
	const [v1, v2] = horizontal ? [c, d] : [a, b]
	const intersects =
		v1.x >= Math.min(h1.x, h2.x) - EPSILON &&
		v1.x <= Math.max(h1.x, h2.x) + EPSILON &&
		h1.y >= Math.min(v1.y, v2.y) - EPSILON &&
		h1.y <= Math.max(v1.y, v2.y) + EPSILON
	return { crossings: intersects ? 1 : 0, overlap: 0 }
}

export function onBoundary(point: Point, box: Box): boolean {
	const insideX = point.x >= box.x - EPSILON && point.x <= box.x + box.width + EPSILON
	const insideY = point.y >= box.y - EPSILON && point.y <= box.y + box.height + EPSILON
	return (
		(insideX && (Math.abs(point.y - box.y) < EPSILON || Math.abs(point.y - box.y - box.height) < EPSILON)) ||
		(insideY && (Math.abs(point.x - box.x) < EPSILON || Math.abs(point.x - box.x - box.width) < EPSILON))
	)
}
