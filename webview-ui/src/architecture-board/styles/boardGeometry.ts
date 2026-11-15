import type { NodeKind } from "@shared/architecture"
import { polygonShape } from "./polygonShape"
import { semanticGeometry } from "./semanticGeometry"
import type { NodeGeometry, ShapeSize } from "./types"

/** Shared silhouettes and proportions keep theme changes independent of layout. */
export const boardNodeSizes = {
	class: { width: 224, height: 160 },
	database: { width: 198, height: 164 },
	function: { width: 280, height: 100 },
	api_endpoint: { width: 216, height: 196 },
	component: { width: 248, height: 128 },
	service: { width: 224, height: 160 },
	state: { width: 224, height: 112 },
	actor: { width: 168, height: 168 },
} satisfies Record<Exclude<NodeKind, "group">, ShapeSize>

const base = semanticGeometry({ corner: 8, cylinder: 27, chamfer: 26, groupCorner: 16, socketCorner: 4 })
const compartment = ({ width: w, height: h }: ShapeSize) =>
	polygonShape(
		[
			{ x: 0, y: 0 },
			{ x: w * 0.44, y: 0 },
			{ x: w * 0.52, y: 14 },
			{ x: w, y: 14 },
			{ x: w, y: h },
			{ x: 0, y: h },
		],
		8,
	)
const socket = ({ width: w, height: h }: ShapeSize) =>
	polygonShape(
		[
			{ x: 0, y: 0 },
			{ x: w, y: 0 },
			{ x: w, y: h },
			{ x: 0, y: h },
			{ x: 0, y: h * 0.68 },
			{ x: w * 0.18, y: h * 0.68 },
			{ x: w * 0.18, y: h * 0.32 },
			{ x: 0, y: h * 0.32 },
		],
		14,
	)

/** Drawing and connector docking use the same curves in every theme. */
export const boardGeometry: NodeGeometry = {
	shape(kind, size) {
		if (kind === "class")
			return {
				outline: compartment(size).outline,
				detail: `M 0 ${size.height * 0.3} H ${size.width}`,
			}
		if (kind === "api_endpoint") return { outline: socket(size).outline }
		return base.shape(kind, size)
	},
	portSpan: base.portSpan,
	port(kind, size, side, offset) {
		if (kind === "class") return compartment(size).port(side, offset)
		if (kind === "api_endpoint") return socket(size).port(side, offset)
		return base.port(kind, size, side, offset)
	},
}
