import type { ArchitectureDiagram } from "@shared/architecture"
import { LAYOUT_LIMITS, PREFERRED_ASPECT_RATIO, type LayoutOutput } from "./layoutGraph"
import { absoluteBoxes, EPSILON, hitsBox, onBoundary, routeLength, routeObstacles, segments, type Box } from "./routeGeometry"
import { groupPortSide, shapePort, terminalSide } from "./nodeShapes"
import type { NodeGeometry } from "./styles/types"

function overlaps(a: Box, b: Box): boolean {
	return (
		Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EPSILON &&
		Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EPSILON
	)
}

/** Placement admission is separate from routing: ELK paths may still need repair. */
export function invalidPlacement(boxes: Box[]): string | undefined {
	for (let i = 0; i < boxes.length; i++) {
		const box = boxes[i]
		for (const other of boxes.slice(i + 1)) {
			if (box.ancestors.includes(other.id) || other.ancestors.includes(box.id)) continue
			if (overlaps(box, other)) return `Overlapping nodes: ${box.id}, ${other.id}`
		}
	}
	return undefined
}

/** Reject invalid geometry, not merely a less attractive aspect ratio. */
function invalidGeometry(
	diagram: ArchitectureDiagram,
	layout: LayoutOutput,
	boxes: Box[],
	geometry?: NodeGeometry,
): string | undefined {
	const dockedPort = (id: string, point: { x: number; y: number }, adjacent: { x: number; y: number }, box: Box) => {
		const side = box.group ? groupPortSide(point, adjacent, box) : terminalSide(point, adjacent)
		const offset = side === "top" || side === "bottom" ? point.x - box.x : point.y - box.y
		const length = side === "top" || side === "bottom" ? box.width : box.height
		if (offset < -EPSILON || offset > length + EPSILON) return false
		const expected = shapePort(diagram.nodes.find((node) => node.id === id)!.kind, box, side, offset, geometry)
		const outside =
			box.group ||
			(side === "left"
				? adjacent.x <= box.x
				: side === "right"
					? adjacent.x >= box.x + box.width
					: side === "top"
						? adjacent.y <= box.y
						: adjacent.y >= box.y + box.height)
		return outside && Math.abs(point.x - box.x - expected.x) < EPSILON && Math.abs(point.y - box.y - expected.y) < EPSILON
	}
	const placementError = invalidPlacement(boxes)
	if (placementError) return placementError
	for (const edge of diagram.edges) {
		const route = layout.routes[edge.id]
		if (!route || route.length < 2) return `Missing route: ${edge.id}`
		const source = boxes.find((box) => box.id === edge.source)!
		const target = boxes.find((box) => box.id === edge.target)!
		const sourceDocked = dockedPort(edge.source, route[0], route[1], source)
		const targetDocked = dockedPort(edge.target, route.at(-1)!, route.at(-2)!, target)
		if ((!onBoundary(route[0], source) && !sourceDocked) || (!onBoundary(route.at(-1)!, target) && !targetDocked))
			return `Detached port: ${edge.id}`
		const obstacles = routeObstacles(edge, boxes)
		for (const [index, segment] of segments(route).entries()) {
			const [a, b] = segment
			if (a.x !== b.x && a.y !== b.y) return `Non-orthogonal route: ${edge.id}`
			for (const obstacle of obstacles) {
				// Only the terminal's outward segment may traverse its own silhouette inset.
				if (obstacle.id === edge.source && index === 0 && sourceDocked) continue
				if (obstacle.id === edge.target && index === route.length - 2 && targetDocked) continue
				// A group endpoint can legitimately start/end through its own title band.
				if (
					obstacle.group &&
					((obstacle.id === edge.source && index === 0) || (obstacle.id === edge.target && index === route.length - 2))
				)
					continue
				if (hitsBox(segment, obstacle)) return `Route ${edge.id} enters ${obstacle.id}`
			}
		}
	}
	return undefined
}

export function measureLayout(
	diagram: ArchitectureDiagram,
	layout: LayoutOutput,
	geometry?: NodeGeometry,
	aspectRatio = PREFERRED_ASPECT_RATIO,
): {
	extent: number
	routeLength: number
	bends: number
	invalid?: string
} {
	const boxes = absoluteBoxes(diagram, layout)
	const points = [
		...boxes.flatMap((box) => [
			{ x: box.x, y: box.y },
			{ x: box.x + box.width, y: box.y + box.height },
		]),
		...Object.values(layout.routes).flat(),
	]
	let left = Infinity
	let top = Infinity
	let right = -Infinity
	let bottom = -Infinity
	for (const point of points) {
		left = Math.min(left, point.x)
		right = Math.max(right, point.x)
		top = Math.min(top, point.y)
		bottom = Math.max(bottom, point.y)
	}
	// Measure visible geometry, including remaining routes, rather than obsolete ELK wrap lanes.
	const extent = points.length ? Math.max((right - left + 24) / aspectRatio, bottom - top + 24) : 24
	if (!Number.isFinite(extent) || extent < 0 || extent > LAYOUT_LIMITS.dimension)
		throw new Error("Layout returned invalid drawing bounds")
	return {
		extent,
		routeLength: Object.values(layout.routes).reduce((sum, route) => sum + routeLength(route), 0),
		bends: Object.values(layout.routes).reduce((sum, route) => sum + Math.max(0, route.length - 2), 0),
		invalid: invalidGeometry(diagram, layout, boxes, geometry),
	}
}
