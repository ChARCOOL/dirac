import type { ArchitectureDiagram, ArchitecturePosition as Point } from "@shared/architecture"
import type { LayoutOutput } from "./layoutGraph"
import type { LineJump, RouteJumps } from "./lineJumpTypes"
import { absoluteBoxes, EPSILON, routeObstacles, samePoint, segments, type Box, type Segment } from "./routeGeometry"

export interface CrossingIssue {
	edge: string
	other: string
	point: Point
}
interface Run {
	edge: string
	index: number
	line: Segment
	horizontal: boolean
}
interface Crossing {
	owner: Run
	under: Run
	point: Point
	radius: number
	side: number
}
export const MAX_INTERSECTION_CHECKS = 2_000_000

export interface CrossingBudget {
	checks: number
}

function consumeCrossingWork(budget: CrossingBudget): void {
	if (++budget.checks > MAX_INTERSECTION_CHECKS) throw new Error("Relationship crossings exceed the geometry work limit")
}
const MAX_RADIUS = 16
const CORNER_SPACE = 4

function coordinate(point: Point, horizontal: boolean): number {
	return horizontal ? point.x : point.y
}
function bounds(run: Run): [number, number] {
	const values = run.line.map((point) => coordinate(point, run.horizontal))
	return [Math.min(...values), Math.max(...values)]
}
function overlaps(a: Box, b: { x: number; y: number; width: number; height: number }): boolean {
	return a.x < b.x + b.width + 1 && a.x + a.width > b.x - 1 && a.y < b.y + b.height + 1 && a.y + a.height > b.y - 1
}
function jumpSpace(
	run: Run,
	from: number,
	to: number,
	obstacles: () => readonly Box[],
	budget: CrossingBudget,
): { radius: number; side: number } | undefined {
	const [low, high] = bounds(run)
	const available = Math.min(MAX_RADIUS, from - low - CORNER_SPACE, high - to - CORNER_SPACE)
	// Corner contacts cannot carry a hop; do not build or scan obstacles for them.
	if (available < 2) return undefined
	const occupied = obstacles()
	for (const radius of [available, 12, 8, 6, 4, 2].filter((r) => r >= 2 && r <= available)) {
		for (const side of [-1, 1]) {
			const fixed = coordinate(run.line[0], !run.horizontal)
			const region = run.horizontal
				? { x: from - radius, y: fixed + Math.min(0, side * radius), width: to - from + 2 * radius, height: radius }
				: { x: fixed + Math.min(0, side * radius), y: from - radius, width: radius, height: to - from + 2 * radius }
			if (
				!occupied.some((box) => {
					consumeCrossingWork(budget)
					return overlaps(box, region)
				})
			)
				return { radius, side }
		}
	}
	return undefined
}

/** One stable owner per crossing. The under-line has a real gap where the arc passes,
 * not a background-colored eraser, so tinted frames and selection order remain correct. */
export function planLineJumps(
	diagram: ArchitectureDiagram,
	layout: LayoutOutput,
	budget: CrossingBudget = { checks: 0 },
): {
	decorations: Record<string, RouteJumps>
	issues: CrossingIssue[]
} {
	const boxes = absoluteBoxes(diagram, layout)
	const obstacles = new Map(diagram.edges.map((edge) => [edge.id, routeObstacles(edge, boxes)]))
	const decorations: Record<string, RouteJumps> = Object.fromEntries(
		diagram.edges.map((edge) => [edge.id, { jumps: [], gaps: [] }]),
	)
	const runs: Run[] = Object.keys(layout.routes)
		.sort()
		.flatMap((edge) =>
			segments(layout.routes[edge]).map((line, index) => ({
				edge,
				index,
				line,
				horizontal: line[0].y === line[1].y,
			})),
		)
	// Parallel obstacles depend on the relationship and orientation, not the crossing.
	// Rebuilding them per crossing made dense diagrams cubic in route segments.
	const parallelObstacles = new Map<string, Box[]>()
	const spaceFor = (run: Run, from: number, to: number) =>
		jumpSpace(
			run,
			from,
			to,
			() => {
				const key = `${run.edge}:${run.horizontal}`
				let occupied = parallelObstacles.get(key)
				if (!occupied) {
					occupied = [...obstacles.get(run.edge)!]
					for (const other of runs) {
						consumeCrossingWork(budget)
						if (other.horizontal !== run.horizontal || other.edge === run.edge) continue
						occupied.push({
							id: other.edge,
							x: Math.min(other.line[0].x, other.line[1].x),
							y: Math.min(other.line[0].y, other.line[1].y),
							width: Math.abs(other.line[1].x - other.line[0].x),
							height: Math.abs(other.line[1].y - other.line[0].y),
							ancestors: [],
							group: false,
						})
					}
					parallelObstacles.set(key, occupied)
				}
				return occupied
			},
			budget,
		)
	const horizontals = runs.filter((run) => run.horizontal).sort((a, b) => bounds(a)[0] - bounds(b)[0])
	const verticals = runs.filter((run) => !run.horizontal).sort((a, b) => a.line[0].x - b.line[0].x)
	const crossings: Crossing[] = []
	const issues: CrossingIssue[] = []
	let active: Run[] = []
	let index = 0
	for (const vertical of verticals) {
		const x = vertical.line[0].x
		while (index < horizontals.length && bounds(horizontals[index])[0] <= x + EPSILON) active.push(horizontals[index++])
		active = active.filter((run) => bounds(run)[1] >= x - EPSILON)
		for (const horizontal of active) {
			consumeCrossingWork(budget)
			if (horizontal.edge === vertical.edge) continue
			const y = horizontal.line[0].y
			const [top, bottom] = bounds(vertical)
			if (y < top - EPSILON || y > bottom + EPSILON) continue
			const point = { x, y }
			const terminals = (run: Run) => [layout.routes[run.edge][0], layout.routes[run.edge].at(-1)!]
			if (terminals(horizontal).some((p) => samePoint(p, point)) && terminals(vertical).some((p) => samePoint(p, point)))
				continue
			// Prefer horizontal bridges; orientation and ownership never depend on hover/selection.
			const choice = [horizontal, vertical]
				.map((owner) => {
					const space = spaceFor(owner, coordinate(point, owner.horizontal), coordinate(point, owner.horizontal))
					const under = owner === horizontal ? vertical : horizontal
					const [low, high] = bounds(under)
					const at = coordinate(point, under.horizontal)
					if (space) space.radius = Math.min(space.radius, (Math.min(at - low, high - at) - CORNER_SPACE) / 1.5)
					return { owner, space: space && space.radius >= 2 ? space : undefined }
				})
				.find((option) => option.space)
			if (!choice) {
				const distance = (run: Run) => Math.min(...terminals(run).map((p) => Math.abs(p.x - x) + Math.abs(p.y - y)))
				const move = distance(horizontal) >= distance(vertical) ? horizontal : vertical
				issues.push({ edge: move.edge, other: move === horizontal ? vertical.edge : horizontal.edge, point })
				continue
			}
			crossings.push({
				owner: choice.owner,
				under: choice.owner === horizontal ? vertical : horizontal,
				point,
				...choice.space!,
			})
		}
	}
	const groups = new Map<string, Crossing[]>()
	for (const crossing of crossings) {
		const key = `${crossing.owner.edge}:${crossing.owner.index}`
		const group = groups.get(key)
		if (group) group.push(crossing)
		else groups.set(key, [crossing])
	}
	for (const group of groups.values()) {
		const run = group[0].owner
		group.sort((a, b) => coordinate(a.point, run.horizontal) - coordinate(b.point, run.horizontal))
		let cluster: Crossing[] = []
		const publish = () => {
			const from = coordinate(cluster[0].point, run.horizontal)
			const to = coordinate(cluster.at(-1)!.point, run.horizontal)
			const space = spaceFor(run, from, to)
			if (!space) {
				for (const cross of cluster) issues.push({ edge: run.edge, other: cross.under.edge, point: cross.point })
				return
			}
			space.radius = Math.min(space.radius, ...cluster.map((cross) => cross.radius))
			const jump: LineJump = { segment: run.index, from, to, ...space }
			decorations[run.edge].jumps.push(jump)
			for (const cross of cluster)
				decorations[cross.under.edge].gaps.push({
					segment: cross.under.index,
					at: coordinate(cross.point, cross.under.horizontal),
					across: coordinate(cross.point, run.horizontal),
					jump,
				})
		}
		for (const crossing of group) {
			if (
				cluster.length &&
				coordinate(crossing.point, run.horizontal) - coordinate(cluster.at(-1)!.point, run.horizontal) > 2 * MAX_RADIUS
			) {
				publish()
				cluster = []
			}
			cluster.push(crossing)
		}
		if (cluster.length) publish()
	}
	return { decorations, issues }
}
