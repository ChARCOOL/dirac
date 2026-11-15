import type { ArchitectureDiagram } from "@shared/architecture"
import { FIT_PADDING, PREFERRED_ASPECT_RATIO, type LayoutInput, type LayoutOutput } from "./layoutTypes"
import { absoluteBoxes, routeLength } from "./routeGeometry"
import { MIN_READING_ZOOM } from "./textLayout"

export { FIT_PADDING, PREFERRED_ASPECT_RATIO } from "./layoutTypes"

/** Allocate breathing room before placement, not by stretching a finished drawing. */
export function allocateLayoutSpace({ diagram, dimensions, canvas }: LayoutInput) {
	if (!canvas) return undefined
	if (![canvas.width, canvas.height].every((value) => Number.isFinite(value) && value > 0))
		throw new Error("Layout requires a positive canvas size")
	const width = canvas.width / (1 + 2 * FIT_PADDING)
	const height = canvas.height / (1 + 2 * FIT_PADDING)
	const leaves = diagram.nodes.filter((node) => node.kind !== "group")
	const nodes = new Map(diagram.nodes.map((node) => [node.id, node]))
	const groupWeights = new Map<string, number>()
	for (const leaf of leaves) {
		let parent = leaf.parentId
		while (parent) {
			groupWeights.set(parent, (groupWeights.get(parent) ?? 0) + 1)
			parent = nodes.get(parent)!.parentId
		}
	}
	const footprint = leaves.reduce((area, node) => {
		const size = dimensions[node.id]
		return area + (size.width + 104) * (size.height + 72)
	}, 0)
	// Spend surplus area on gaps, not enlarged cards. Dense graphs still get a
	// usable minimum corridor; a large monitor cannot create unbounded wiring.
	const scale = footprint ? Math.max(1, Math.min(1.6, Math.sqrt((width * height) / footprint))) : 1
	const aspectRatio = canvas.width / canvas.height
	return {
		aspectRatio,
		groupAspectRatios: new Map([...groupWeights].map(([id, weight]) => [id, (aspectRatio * weight) / leaves.length])),
		nodeGap: Math.round(64 * scale),
		layerGap: Math.round(104 * scale),
	}
}

/** Screen-space readability and crowding take precedence over wire compaction. */
export function measureComposition(
	diagram: ArchitectureDiagram,
	layout: LayoutOutput,
	canvas: NonNullable<LayoutInput["canvas"]>,
) {
	const boxes = absoluteBoxes(diagram, layout)
	const points = [
		...boxes.flatMap((box) => [
			{ x: box.x, y: box.y },
			{ x: box.x + box.width, y: box.y + box.height },
		]),
		...Object.values(layout.routes).flat(),
	]
	if (!points.length) return { zoom: 1, crowding: 0, unused: 0, cost: 0 }
	let left = Infinity,
		top = Infinity,
		right = -Infinity,
		bottom = -Infinity
	for (const point of points) {
		left = Math.min(left, point.x)
		right = Math.max(right, point.x)
		top = Math.min(top, point.y)
		bottom = Math.max(bottom, point.y)
	}
	const width = right - left
	const height = bottom - top
	const availableWidth = canvas.width / (1 + 2 * FIT_PADDING)
	const availableHeight = canvas.height / (1 + 2 * FIT_PADDING)
	const zoom = Math.min(1, availableWidth / width, availableHeight / height)
	const leaves = boxes.filter((box) => !box.group)
	const crowding =
		leaves.reduce((sum, box) => {
			let nearest = Infinity
			for (const other of leaves) {
				if (other.id === box.id) continue
				const dx = Math.max(0, box.x - other.x - other.width, other.x - box.x - box.width)
				const dy = Math.max(0, box.y - other.y - other.height, other.y - box.y - box.height)
				nearest = Math.min(nearest, Math.hypot(dx, dy))
			}
			return sum + Math.max(0, 1 - (nearest * zoom) / 32) ** 2
		}, 0) / Math.max(1, leaves.length)
	const unused = 1 - (width * height * zoom ** 2) / (availableWidth * availableHeight)
	const wire = Object.values(layout.routes).reduce((sum, route) => sum + routeLength(route), 0)
	const averageWidth = leaves.reduce((sum, box) => sum + box.width, 0) / Math.max(1, leaves.length)
	const normalizedWire = wire / Math.max(1, averageWidth * leaves.length)
	// Prefer candidates whose primary titles remain at least 14 screen pixels.
	// Explicit Fit can still show a smaller overview; normal reading uses this floor.
	const cost = 4 * Math.max(0, MIN_READING_ZOOM / zoom - 1) ** 2 + 3 * crowding + 0.75 * unused + 0.02 * normalizedWire
	return { zoom, crowding, unused, cost }
}

export function layoutAspectRatio(input: LayoutInput): number {
	return input.canvas ? input.canvas.width / input.canvas.height : PREFERRED_ASPECT_RATIO
}
