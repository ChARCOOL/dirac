import type { ArchitecturePosition as Point } from "@shared/architecture"
import type { PortSide } from "./types"

interface Corner extends Point {
	radius?: number
}
const EPSILON = 1e-8

/** Filleted polygon drawing and orthogonal projection share the exact same quadratic segments. */
export function polygonShape(vertices: Corner[], radius = 0) {
	const corners = vertices.map((point, index) => {
		const previous = vertices[(index + vertices.length - 1) % vertices.length]
		const next = vertices[(index + 1) % vertices.length]
		const incoming = Math.hypot(previous.x - point.x, previous.y - point.y)
		const outgoing = Math.hypot(next.x - point.x, next.y - point.y)
		const distance = Math.min(point.radius ?? radius, incoming / 2, outgoing / 2)
		return {
			control: point,
			start: {
				x: point.x + ((previous.x - point.x) * distance) / incoming,
				y: point.y + ((previous.y - point.y) * distance) / incoming,
			},
			end: {
				x: point.x + ((next.x - point.x) * distance) / outgoing,
				y: point.y + ((next.y - point.y) * distance) / outgoing,
			},
		}
	})
	const outline = `M ${corners[0].start.x} ${corners[0].start.y} ${corners
		.map((corner, index) => {
			const next = corners[(index + 1) % corners.length]
			return `Q ${corner.control.x} ${corner.control.y} ${corner.end.x} ${corner.end.y} L ${next.start.x} ${next.start.y}`
		})
		.join(" ")} Z`
	return {
		outline,
		port(side: PortSide, offset: number): Point {
			const horizontal = side === "top" || side === "bottom"
			const axis = horizontal ? "x" : "y"
			const cross = horizontal ? "y" : "x"
			const intersections: number[] = []
			for (const [index, { start, control, end }] of corners.entries()) {
				for (const t of quadraticRoots(start[axis], control[axis], end[axis], offset)) {
					if (t >= -EPSILON && t <= 1 + EPSILON)
						intersections.push((1 - t) ** 2 * start[cross] + 2 * (1 - t) * t * control[cross] + t ** 2 * end[cross])
				}
				const next = corners[(index + 1) % corners.length].start
				const length = next[axis] - end[axis]
				if (Math.abs(length) < EPSILON) {
					if (Math.abs(offset - end[axis]) < EPSILON) intersections.push(end[cross], next[cross])
					continue
				}
				const t = (offset - end[axis]) / length
				if (t >= -EPSILON && t <= 1 + EPSILON) intersections.push(end[cross] + t * (next[cross] - end[cross]))
			}
			const coordinate = side === "left" || side === "top" ? Math.min(...intersections) : Math.max(...intersections)
			return horizontal ? { x: offset, y: coordinate } : { x: coordinate, y: offset }
		},
	}
}

function quadraticRoots(start: number, control: number, end: number, offset: number): number[] {
	const a = start - 2 * control + end
	const b = 2 * (control - start)
	const c = start - offset
	if (Math.abs(a) < EPSILON) {
		if (Math.abs(b) >= EPSILON) return [-c / b]
		return Math.abs(c) < EPSILON ? [0, 1] : []
	}
	const discriminant = b * b - 4 * a * c
	if (discriminant < -EPSILON) return []
	const root = Math.sqrt(Math.max(0, discriminant))
	return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
}
