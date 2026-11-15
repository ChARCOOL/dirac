import type { ArchitecturePosition, NodeKind } from "@shared/architecture"

export type PortSide = "left" | "right" | "top" | "bottom"
export interface ShapeSize {
	width: number
	height: number
}
export interface NodeGeometry {
	shape(kind: NodeKind, size: ShapeSize): { outline: string; detail?: string }
	portSpan(kind: NodeKind, side: PortSide, size: ShapeSize): [number, number]
	port(kind: NodeKind, size: ShapeSize, side: PortSide, offset: number): ArchitecturePosition
}

/** Pure data/geometry only: style modules are also loaded by the layout worker. */
export interface BoardStyle {
	id: string
	label: string
	order: number
	geometry: NodeGeometry
	/** Whole-silhouette gradient, with stops supplied by the theme's CSS. */
	nodeGradient?: boolean
	grid?: "dots" | "lines"
	/** Idle screen-pixel stroke; selection emphasis is shared by all relationship kinds. */
	edgeWidth: number
	dataDash: [number, number]
	dependencyDash: [number, number]
	messageDash: [number, number, number, number]
}
