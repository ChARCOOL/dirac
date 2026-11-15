import type { ArchitecturePosition as Point, NodeKind } from "@shared/architecture"
import { boardGeometry } from "./styles/boardGeometry"
import type { NodeGeometry, PortSide, ShapeSize } from "./styles/types"
export type { PortSide, ShapeSize } from "./styles/types"

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
	component: "Component",
	class: "Class",
	function: "Function",
	database: "Database",
	service: "Service",
	api_endpoint: "API endpoint",
	state: "State",
	actor: "Actor",
	group: "Subsystem",
}

/** Rendering, port search and route validation use the same style geometry. */
export function nodeShape(kind: NodeKind, size: ShapeSize, geometry: NodeGeometry = boardGeometry) {
	return geometry.shape(kind, size)
}
export function portSpan(kind: NodeKind, side: PortSide, size: ShapeSize, geometry: NodeGeometry = boardGeometry) {
	return geometry.portSpan(kind, side, size)
}
export function shapePort(
	kind: NodeKind,
	size: ShapeSize,
	side: PortSide,
	offset: number,
	geometry: NodeGeometry = boardGeometry,
): Point {
	return geometry.port(kind, size, side, offset)
}
/** Group connections can approach from inside or outside; direction alone cannot identify the frame side. */
export function groupPortSide(point: Point, adjacent: Point, bounds: Point & ShapeSize): PortSide {
	if (Math.abs(point.y - adjacent.y) < 0.000001) return point.x < bounds.x + bounds.width / 2 ? "left" : "right"
	return point.y < bounds.y + bounds.height / 2 ? "top" : "bottom"
}

export function terminalSide(point: Point, adjacent: Point): PortSide {
	if (Math.abs(point.y - adjacent.y) < 0.000001) return adjacent.x < point.x ? "left" : "right"
	return adjacent.y < point.y ? "top" : "bottom"
}
