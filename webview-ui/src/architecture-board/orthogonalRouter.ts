import type { ArchitecturePosition as Point } from "@shared/architecture"
import {
	EPSILON,
	ROUTE_CLEARANCE,
	hitsBox,
	normalizeRoute,
	routeLength,
	segmentContact,
	segments,
	type Box,
	type Segment,
} from "./routeGeometry"

export interface RoutingBudget {
	checks: number
	exhausted: boolean
	limit?: number
}
export const MAX_ROUTE_CHECKS = 4_000_000
const LANE_GAP = 10
const MIN_LANE_GAP = 4
const HOP_CLEARANCE = 8

interface Step {
	point: number
	direction: number
	distance: number
	bends: number
	score: number
	turns: number
	previous?: Step
}

/** Admissible distance estimate: Manhattan distance plus the largest unavoidable
 * single-obstacle detour. Take the maximum, never the sum: obstacles can share a detour.
 * Endpoint direction and lanes can only add distance, so they need not enter this bound. */
export function routeDistanceLowerBound(start: Point, end: Point, obstacles: Box[]): number {
	let detour = 0
	const left = Math.min(start.x, end.x)
	const right = Math.max(start.x, end.x)
	const top = Math.min(start.y, end.y)
	const bottom = Math.max(start.y, end.y)
	for (const box of obstacles) {
		const x1 = box.x - ROUTE_CLEARANCE
		const x2 = box.x + box.width + ROUTE_CLEARANCE
		const y1 = box.y - ROUTE_CLEARANCE
		const y2 = box.y + box.height + ROUTE_CLEARANCE
		if (top <= y1 && bottom >= y2 && left > x1 && right < x2) detour = Math.max(detour, 2 * Math.min(left - x1, x2 - right))
		if (left <= x1 && right >= x2 && top > y1 && bottom < y2) detour = Math.max(detour, 2 * Math.min(top - y1, y2 - bottom))
	}
	return routeLength([start, end]) + detour
}

function remainingBends(point: Point, end: Point, incoming: number, outgoing: number): number {
	if (point.x === end.x && point.y === end.y) return Number(incoming !== outgoing)
	const horizontal = end.x > point.x ? 0 : 2
	const vertical = end.y > point.y ? 1 : 3
	if (point.x === end.x) return Number(incoming !== vertical) + Number(vertical !== outgoing)
	if (point.y === end.y) return Number(incoming !== horizontal) + Number(horizontal !== outgoing)
	return (
		1 +
		Math.min(
			Number(incoming !== horizontal) + Number(vertical !== outgoing),
			Number(incoming !== vertical) + Number(horizontal !== outgoing),
		)
	)
}

/** Lexicographic A*: wire length first, bends second, stable coordinates last. */
class Frontier {
	private items: Step[] = []
	private before(a: Step, b: Step): boolean {
		return (
			a.score < b.score ||
			(a.score === b.score &&
				(a.turns < b.turns ||
					(a.turns === b.turns && (a.distance > b.distance || (a.distance === b.distance && a.point < b.point)))))
		)
	}
	push(step: Step): void {
		let index = this.items.length
		this.items.push(step)
		while (index) {
			const parent = (index - 1) >> 1
			if (!this.before(step, this.items[parent])) break
			this.items[index] = this.items[parent]
			index = parent
		}
		this.items[index] = step
	}
	pop(): Step | undefined {
		const first = this.items[0]
		const last = this.items.pop()
		if (!this.items.length) return first
		let index = 0
		while (index * 2 + 1 < this.items.length) {
			let child = index * 2 + 1
			if (child + 1 < this.items.length && this.before(this.items[child + 1], this.items[child])) child++
			if (!this.before(this.items[child], last!)) break
			this.items[index] = this.items[child]
			index = child
		}
		this.items[index] = last!
		return first
	}
}

export function direction(a: Point, b: Point): number {
	return a.y === b.y ? (b.x > a.x ? 0 : 2) : b.y > a.y ? 1 : 3
}

/** One caller-owned allowance for search work, including cached-state visits.
 * A separate visit cap must not mark a shared allowance exhausted while work remains. */
function consumeRoutingWork(budget: RoutingBudget): boolean {
	if (budget.exhausted || budget.checks >= (budget.limit ?? MAX_ROUTE_CHECKS)) {
		budget.exhausted = true
		return false
	}
	budget.checks++
	return true
}

function clear(segment: Segment, obstacles: Box[], lanes: Segment[], budget: RoutingBudget): boolean {
	for (const box of obstacles) {
		if (!consumeRoutingWork(budget)) return false
		if (hitsBox(segment, box, ROUTE_CLEARANCE)) return false
	}
	for (const lane of lanes) {
		if (!consumeRoutingWork(budget)) return false
		// Crossings are deliberately NOT obstacles. Only parallel runs need separate lanes.
		const separation = segment[0].y === segment[1].y ? Math.abs(segment[0].y - lane[0].y) : Math.abs(segment[0].x - lane[0].x)
		if (separation < MIN_LANE_GAP - EPSILON && segmentContact(segment, lane).overlap > EPSILON) return false
		if ((segment[0].y === segment[1].y) !== (lane[0].y === lane[1].y) && segmentContact(segment, lane).crossings) {
			const at = segment[0].y === segment[1].y ? segment[0].y : segment[0].x
			const axis = segment[0].y === segment[1].y ? "y" : "x"
			if (Math.min(Math.abs(at - lane[0][axis]), Math.abs(at - lane[1][axis])) < HOP_CLEARANCE - EPSILON) return false
		}
	}
	return true
}

function clearTurn(point: Point, lanes: Segment[]): boolean {
	return !lanes.some((lane) =>
		hitsBox(lane, {
			id: "turn",
			x: point.x - HOP_CLEARANCE,
			y: point.y - HOP_CLEARANCE,
			width: 2 * HOP_CLEARANCE,
			height: 2 * HOP_CLEARANCE,
			ancestors: [],
			group: false,
		}),
	)
}

/** A coordinate-compressed visibility grid includes every obstacle boundary and port.
 * Search is bounded; undefined means no checked route was found, never a guessed path. */
export function shortestOrthogonalRoute(
	start: Point,
	end: Point,
	startDirection: number,
	endDirection: number,
	obstacles: Box[],
	lanes: Segment[],
	budget: RoutingBudget,
): Point[] | undefined {
	const accepts = (path: Point[]) => {
		if (path.length < 2) return false
		if (direction(path[0], path[1]) === (startDirection + 2) % 4) return false
		if (direction(path[path.length - 2], path[path.length - 1]) === (endDirection + 2) % 4) return false
		if (!path.slice(1, -1).every((point) => clearTurn(point, lanes))) return false
		if (direction(path[0], path[1]) !== startDirection && !clearTurn(start, lanes)) return false
		if (direction(path[path.length - 2], path[path.length - 1]) !== endDirection && !clearTurn(end, lanes)) return false
		return segments(path).every((segment) => clear(segment, obstacles, lanes, budget))
	}
	const direct = [
		[start, { x: end.x, y: start.y }, end],
		[start, { x: start.x, y: end.y }, end],
	]
		.map(normalizeRoute)
		.sort((a, b) => a.length - b.length)
	for (const path of direct) if (accepts(path)) return path
	if (budget.exhausted) return undefined

	const xs = new Set([start.x, end.x])
	const ys = new Set([start.y, end.y])
	for (const box of obstacles) {
		xs.add(box.x - ROUTE_CLEARANCE).add(box.x + box.width + ROUTE_CLEARANCE)
		ys.add(box.y - ROUTE_CLEARANCE).add(box.y + box.height + ROUTE_CLEARANCE)
	}
	for (const [a, b] of lanes) {
		for (const point of [a, b]) {
			xs.add(point.x - HOP_CLEARANCE).add(point.x + HOP_CLEARANCE)
			ys.add(point.y - HOP_CLEARANCE).add(point.y + HOP_CLEARANCE)
		}
		if (a.y === b.y)
			ys.add(a.y - LANE_GAP)
				.add(a.y + LANE_GAP)
				.add(a.y - MIN_LANE_GAP)
				.add(a.y + MIN_LANE_GAP)
		else
			xs.add(a.x - LANE_GAP)
				.add(a.x + LANE_GAP)
				.add(a.x - MIN_LANE_GAP)
				.add(a.x + MIN_LANE_GAP)
	}
	const x = [...xs].sort((a, b) => a - b)
	const y = [...ys].sort((a, b) => a - b)
	const width = x.length
	const point = (id: number): Point => ({ x: x[id % width], y: y[Math.floor(id / width)] })
	const origin = y.indexOf(start.y) * width + x.indexOf(start.x)
	const destination = y.indexOf(end.y) * width + x.indexOf(end.x)
	const frontier = new Frontier()
	const best = new Map<number, Step>()
	const visibility = new Map<string, boolean>()
	const turns = new Map<number, boolean>()
	const canTurn = (id: number) => {
		let result = turns.get(id)
		if (result === undefined) {
			result = clearTurn(point(id), lanes)
			turns.set(id, result)
		}
		return result
	}
	const estimates = new Map<number, number>()
	const estimate = (id: number) => {
		let distance = estimates.get(id)
		if (distance === undefined) {
			distance = routeDistanceLowerBound(point(id), end, obstacles)
			estimates.set(id, distance)
		}
		return distance
	}
	frontier.push({
		point: origin,
		direction: startDirection,
		distance: 0,
		bends: 0,
		score: estimate(origin),
		turns: remainingBends(start, end, startDirection, endDirection),
	})
	let step: Step | undefined
	while ((step = frontier.pop())) {
		if (!consumeRoutingWork(budget)) return undefined
		if (step.previous && best.get(step.point * 4 + step.direction) !== step) continue
		if (
			step.point === destination &&
			step.direction !== (endDirection + 2) % 4 &&
			(step.direction === endDirection || canTurn(destination))
		) {
			const path: Point[] = []
			for (let cursor: Step | undefined = step; cursor; cursor = cursor.previous) path.push(point(cursor.point))
			return normalizeRoute(path.reverse())
		}
		const a = point(step.point)
		const column = step.point % width
		const row = Math.floor(step.point / width)
		const neighbors = [
			column + 1 < width ? step.point + 1 : -1,
			row + 1 < y.length ? step.point + width : -1,
			column > 0 ? step.point - 1 : -1,
			row > 0 ? step.point - width : -1,
		]
		for (const [dir, next] of neighbors.entries()) {
			if (next < 0 || dir === (step.direction + 2) % 4) continue
			if (dir !== step.direction && !canTurn(step.point)) continue
			const b = point(next)
			const distance = step.distance + routeLength([a, b])
			const bends = step.bends + Number(dir !== step.direction)
			const key = next * 4 + dir
			const prior = best.get(key)
			if (prior && (prior.distance < distance || (prior.distance === distance && prior.bends <= bends))) continue
			const segmentKey = `${Math.min(step.point, next)}:${Math.max(step.point, next)}`
			let visible = visibility.get(segmentKey)
			if (visible === undefined) {
				visible = clear([a, b], obstacles, lanes, budget)
				visibility.set(segmentKey, visible)
			}
			if (!visible) continue
			const entry = {
				point: next,
				direction: dir,
				distance,
				bends,
				score: distance + estimate(next),
				turns: bends + remainingBends(b, end, dir, endDirection),
				previous: step,
			}
			best.set(key, entry)
			frontier.push(entry)
		}
	}
	return undefined
}
