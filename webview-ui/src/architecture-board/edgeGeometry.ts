import type { ArchitecturePosition as Point } from "@shared/architecture"
import type { RouteJumps } from "./lineJumpTypes"

interface Event {
	from: number
	to: number
	arc?: { radius: number; side: number }
}

/** Rounded bends, actual elliptical bridge arcs and transparent under-line gaps.
 * Metadata is worker-owned; zoom only changes radii within its checked free space. */
export function roundedRoute(
	points: Point[],
	decorations?: RouteJumps,
	zoom = 1,
): {
	path: string
	label: Point
	interactionPath: string
} {
	let path = `M ${points[0].x} ${points[0].y}`
	let longest = -1
	let label = points[0]
	const hasJumps = !!decorations && (decorations.jumps.length > 0 || decorations.gaps.length > 0)
	const radiusAt = (index: number) =>
		index <= 0 || index >= points.length - 1
			? 0
			: Math.min(
					hasJumps ? 4 : 10,
					Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y) / 2,
					Math.hypot(points[index + 1].x - points[index].x, points[index + 1].y - points[index].y) / 2,
				)
	for (let index = 0; index < points.length - 1; index++) {
		const a = points[index]
		const b = points[index + 1]
		const horizontal = a.y === b.y
		const coordinate = (p: Point) => (horizontal ? p.x : p.y)
		const dir = Math.sign(coordinate(b) - coordinate(a)) || 1
		const length = Math.abs(coordinate(b) - coordinate(a))
		const at = (distance: number): Point =>
			horizontal ? { x: a.x + dir * distance, y: a.y } : { x: a.x, y: a.y + dir * distance }
		const svg = (distance: number) => {
			const p = at(distance)
			return `${p.x} ${p.y}`
		}
		const local = (value: number) => (value - coordinate(a)) * dir
		const events: Event[] = []
		for (const jump of decorations?.jumps ?? []) {
			if (jump.segment !== index) continue
			const radius = Math.min(6 / zoom, jump.radius)
			const ends = [local(jump.from - radius), local(jump.to + radius)].sort((a, b) => a - b)
			events.push({ from: ends[0], to: ends[1], arc: { radius, side: jump.side } })
		}
		for (const gap of decorations?.gaps ?? []) {
			if (gap.segment !== index) continue
			const radius = Math.min(6 / zoom, gap.jump.radius)
			const midpoint = (gap.jump.from + gap.jump.to) / 2
			const halfSpan = (gap.jump.to - gap.jump.from) / 2 + radius
			const rise = radius * Math.sqrt(Math.max(0, 1 - ((gap.across - midpoint) / halfSpan) ** 2))
			const center = local(gap.at + gap.jump.side * rise)
			const halfGap = Math.min(3 / zoom, radius / 2)
			events.push({
				from: Math.max(radiusAt(index), center - halfGap),
				to: Math.min(length - radiusAt(index + 1), center + halfGap),
			})
		}
		events.sort((a, b) => a.from - b.from)
		let cursor = radiusAt(index)
		let labelStart = 0
		const labelInterval = (from: number, to: number) => {
			if (to - from > longest) {
				longest = to - from
				label = at((from + to) / 2)
			}
		}
		for (const event of events) {
			labelInterval(labelStart, Math.max(labelStart, event.from - 24 / zoom))
			labelStart = Math.max(labelStart, event.to + 24 / zoom)
			if (event.to <= cursor) continue
			path += ` L ${svg(Math.max(cursor, event.from))}`
			if (event.arc) {
				const span = (event.to - event.from) / 2
				const sweep = Number(horizontal ? event.arc.side * dir < 0 : event.arc.side * dir > 0)
				path += ` A ${horizontal ? span : event.arc.radius} ${horizontal ? event.arc.radius : span} 0 0 ${sweep} ${svg(event.to)}`
			} else path += ` M ${svg(event.to)}`
			cursor = event.to
		}
		labelInterval(labelStart, length)
		const corner = radiusAt(index + 1)
		path += ` L ${svg(length - corner)}`
		if (corner) {
			const next = points[index + 2]
			const nextLength = Math.hypot(next.x - b.x, next.y - b.y)
			path += ` Q ${b.x} ${b.y} ${b.x + ((next.x - b.x) * corner) / nextLength} ${b.y + ((next.y - b.y) * corner) / nextLength}`
		}
	}
	return { path, label, interactionPath: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ") }
}
