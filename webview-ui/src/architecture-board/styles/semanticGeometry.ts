import type { NodeKind } from "@shared/architecture"
import type { NodeGeometry, PortSide, ShapeSize } from "./types"
import { nodeShape, portSpan, shapePort } from "./shapePrimitives"
import { polygonShape } from "./polygonShape"

export function roundedRectangle({ width: w, height: h }: ShapeSize, radius: number): string {
	const r = Math.min(radius, w / 2, h / 2)
	return `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`
}

/** Orthogonal projection onto the same quadratic corner used by roundedRectangle. */
function roundedPort(size: ShapeSize, side: PortSide, offset: number, radius: number) {
	const { width: w, height: h } = size
	const horizontal = side === "top" || side === "bottom"
	const length = horizontal ? w : h
	const r = Math.min(radius, w / 2, h / 2)
	const corner = Math.max(0, r - offset, offset - (length - r))
	const inset = corner && r ? r * (1 - Math.sqrt(1 - corner / r)) ** 2 : 0
	return horizontal
		? { x: offset, y: side === "top" ? inset : h - inset }
		: { x: side === "left" ? inset : w - inset, y: offset }
}

/** Shared shape primitives; styles choose their own silhouette recipe, not a renderer fallback. */
export function semanticGeometry({
	corner = 0,
	chamfer = 12,
	cylinder = 12,
	cards = false,
	groupCorner = 10,
	tabCorner = 1,
	socketCorner = 0,
	roundedService = false,
	angular = false,
}: {
	corner?: number
	chamfer?: number
	cylinder?: number
	cards?: boolean
	groupCorner?: number
	tabCorner?: number
	socketCorner?: number
	roundedService?: boolean
	angular?: boolean
}): NodeGeometry {
	const rectangle = (kind: NodeKind) => kind === "group" || cards || (kind === "class" && !angular)
	const radius = (kind: NodeKind) => (kind === "group" ? groupCorner : corner)
	const polygon = (kind: NodeKind, { width: w, height: h }: ShapeSize) => {
		if (kind === "component") {
			const tabHeight = tabCorner > 1 ? 10 : 8
			const a = h * 0.29 - tabHeight / 2
			const b = h * 0.68 - tabHeight / 2
			const cut = angular ? 8 : 0
			return polygonShape(
				[
					{ x: 8 + cut, y: 0 },
					{ x: w - cut, y: 0 },
					...(angular
						? [
							{ x: w, y: cut },
							{ x: w, y: h - cut },
						]
						: []),
					{ x: w - cut, y: h },
					{ x: 8 + cut, y: h },
					...(angular ? [{ x: 8, y: h - cut }] : []),
					{ x: 8, y: b + tabHeight, radius: tabCorner },
					{ x: 0, y: b + tabHeight, radius: tabCorner },
					{ x: 0, y: b, radius: tabCorner },
					{ x: 8, y: b, radius: tabCorner },
					{ x: 8, y: a + tabHeight, radius: tabCorner },
					{ x: 0, y: a + tabHeight, radius: tabCorner },
					{ x: 0, y: a, radius: tabCorner },
					{ x: 8, y: a, radius: tabCorner },
					...(angular ? [{ x: 8, y: cut }] : []),
				],
				angular ? 0 : corner,
			)
		}
		if (kind === "api_endpoint") {
			const depth = Math.min(16, w / 9)
			const mouth = Math.min(12, h / 4)
			const notchCorner = socketCorner ? 3 : 0
			return polygonShape(
				[
					{ x: 0, y: 0 },
					{ x: w, y: 0 },
					{ x: w, y: h },
					{ x: 0, y: h },
					{ x: 0, y: h / 2 + mouth, radius: notchCorner },
					{ x: depth, y: h / 2 + mouth, radius: notchCorner },
					{ x: depth, y: h / 2 - mouth, radius: notchCorner },
					{ x: 0, y: h / 2 - mouth, radius: notchCorner },
				],
				socketCorner,
			)
		}
		const cut = Math.min(kind === "class" ? 7 : chamfer, h / 3, w / 5)
		return polygonShape(
			[
				{ x: cut, y: 0 },
				{ x: w - cut, y: 0 },
				{ x: w, y: cut },
				{ x: w, y: h - cut },
				{ x: w - cut, y: h },
				{ x: cut, y: h },
				{ x: 0, y: h - cut },
				{ x: 0, y: cut },
			],
			kind === "service" && roundedService ? 3 : 0,
		)
	}
	return {
		shape(kind, size) {
			const { width: w, height: h } = size
			if (kind === "state" || kind === "actor") return nodeShape(kind, size)
			if (rectangle(kind))
				return {
					outline: roundedRectangle(size, radius(kind)),
					detail:
						kind === "group" && cards
							? `M 1 44 H ${w - 1}`
							: !cards && kind === "class"
								? `M 0 32 H ${w}`
								: undefined,
				}
			if (kind === "function") return nodeShape(kind, size)
			if (kind === "database")
				return {
					outline: `M 0 ${cylinder} A ${w / 2} ${cylinder} 0 0 1 ${w} ${cylinder} V ${h - cylinder} A ${w / 2} ${cylinder} 0 0 1 0 ${h - cylinder} Z`,
					detail: `M 0 ${cylinder} A ${w / 2} ${cylinder} 0 0 0 ${w} ${cylinder} M 0 ${h - cylinder - 7} A ${w / 2} ${cylinder} 0 0 0 ${w} ${h - cylinder - 7}`,
				}
			const shape = polygon(kind, size)
			return { outline: shape.outline, detail: kind === "class" ? `M 0 32 H ${w}` : undefined }
		},
		portSpan(kind, side, size) {
			return portSpan(cards && kind !== "state" && kind !== "actor" ? "class" : kind, side, size)
		},
		port(kind, size, side, offset) {
			if (kind === "state" || kind === "actor") return shapePort(kind, size, side, offset)
			if (rectangle(kind)) return roundedPort(size, side, offset, radius(kind))
			if (kind === "function") return shapePort(kind, size, side, offset)
			const { width: w, height: h } = size
			if (kind === "database") {
				if (side === "top" || side === "bottom") {
					const u = (offset - w / 2) / (w / 2)
					const inset = cylinder * (1 - Math.sqrt(Math.max(0, 1 - u * u)))
					return { x: offset, y: side === "top" ? inset : h - inset }
				}
				const u = Math.max(0, cylinder - offset, offset - (h - cylinder)) / cylinder
				const inset = (w / 2) * (1 - Math.sqrt(Math.max(0, 1 - u * u)))
				return { x: side === "left" ? inset : w - inset, y: offset }
			}
			return polygon(kind, size).port(side, offset)
		},
	}
}
