import type { ArchitecturePosition as Point, NodeKind } from "@shared/architecture";
import type { PortSide, ShapeSize } from "./types";

/** The silhouette and its docking geometry are one presentation contract, shared with the worker. */
export function nodeShape(kind: NodeKind, { width: w, height: h }: ShapeSize): { outline: string; detail?: string } {
	switch (kind) {
		case "component": {
			const a = h * 0.25
			const b = h * 0.65
			return {
				outline: `M 8 0 H ${w} V ${h} H 8 V ${b + 14} H 0 V ${b} H 8 V ${a + 14} H 0 V ${a} H 8 Z`,
				detail: `M 8 ${a} H 17 V ${a + 14} H 8 M 8 ${b} H 17 V ${b + 14} H 8`,
			}
		}
		case "actor": {
			const r = Math.min(w, h) / 2
			return { outline: `M ${w / 2 - r} ${h / 2} A ${r} ${r} 0 1 0 ${w / 2 + r} ${h / 2} A ${r} ${r} 0 1 0 ${w / 2 - r} ${h / 2} Z` }
		}
		case "state": {
			const r = Math.min(16, w / 2, h / 2)
			return { outline: `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z` }
		}
		case "class":
			return { outline: `M 0 0 H ${w} V ${h} H 0 Z`, detail: `M 0 23 H ${w}` }
		case "function": {
			const r = Math.min(w, h) / 2
			return {
				outline: `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`,
			}
		}
		case "database":
			return {
				outline: `M 0 12 A ${w / 2} 12 0 0 1 ${w} 12 V ${h - 12} A ${w / 2} 12 0 0 1 0 ${h - 12} Z`,
				detail: `M 0 12 A ${w / 2} 12 0 0 0 ${w} 12 M 0 ${h - 20} A ${w / 2} 12 0 0 0 ${w} ${h - 20}`,
			}
		case "service":
			return { outline: `M 12 0 H ${w - 12} L ${w} 12 V ${h - 12} L ${w - 12} ${h} H 12 L 0 ${h - 12} V 12 Z` }
		case "api_endpoint":
			return {
				outline: `M 0 0 H ${w} V ${h} H 0 V ${h / 2 + 12} H 12 V ${h / 2 - 12} H 0 Z`,
				detail: `M ${w - 12} 0 V ${h}`,
			}
		case "group":
			return { outline: `M 0 0 H ${w} V ${h} H 0 Z` }
	}
}

/** Keep ports off corners and decorative tabs; multiple relationships retain distinct slots. */
export function portSpan(kind: NodeKind, side: PortSide, size: ShapeSize): [number, number] {
	const horizontal = side === "top" || side === "bottom"
	const length = horizontal ? size.width : size.height
	if (kind === "actor") {
		// Stay away from tangents; all slots project onto the circular silhouette.
		const span = Math.min(size.width, size.height) * 0.35
		return [length / 2 - span, length / 2 + span]
	}
	const inset = kind === "function" ? (horizontal ? Math.min(size.width, size.height) / 2 + 8 : 16) : 20
	return [Math.min(inset, length / 3), Math.max(length - inset, (length * 2) / 3)]
}

/** Project an envelope port onto the actual silhouette, along its orthogonal approach. */
export function shapePort(kind: NodeKind, size: ShapeSize, side: PortSide, offset: number): Point {
	const { width: w, height: h } = size
	const horizontal = side === "top" || side === "bottom"
	const x = horizontal ? offset : side === "left" ? 0 : w
	const y = horizontal ? (side === "top" ? 0 : h) : offset
	if (kind === "actor") {
		const r = Math.min(w, h) / 2
		const center = horizontal ? w / 2 : h / 2
		const axis = Math.max(center - r, Math.min(center + r, offset))
		const reach = Math.sqrt(Math.max(0, r * r - (axis - center) ** 2))
		return horizontal
			? { x: axis, y: h / 2 + (side === "top" ? -reach : reach) }
			: { x: w / 2 + (side === "left" ? -reach : reach), y: axis }
	}
	if (kind === "state") {
		const length = horizontal ? w : h
		const r = Math.min(16, w / 2, h / 2)
		const corner = Math.max(0, r - offset, offset - (length - r))
		const inset = corner && r ? r * (1 - Math.sqrt(1 - corner / r)) ** 2 : 0
		return horizontal ? { x, y: side === "top" ? inset : h - inset } : { x: side === "left" ? inset : w - inset, y }
	}
	if (kind === "function") {
		const r = Math.min(w, h) / 2
		if (!horizontal) {
			const dy = y < r ? r - y : y > h - r ? y - (h - r) : 0
			const inset = r - Math.sqrt(Math.max(0, r * r - dy * dy))
			return { x: side === "left" ? inset : w - inset, y }
		}
		const dx = x < r ? r - x : x > w - r ? x - (w - r) : 0
		const inset = r - Math.sqrt(Math.max(0, r * r - dx * dx))
		return { x, y: side === "top" ? inset : h - inset }
	}
	if (kind === "database" && horizontal) {
		const u = (x - w / 2) / (w / 2)
		const inset = 12 - 12 * Math.sqrt(Math.max(0, 1 - u * u))
		return { x, y: side === "top" ? inset : h - inset }
	}
	if (kind === "database" && !horizontal && (y < 12 || y > h - 12)) {
		const u = y < 12 ? (12 - y) / 12 : (y - h + 12) / 12
		const inset = (w / 2) * (1 - Math.sqrt(Math.max(0, 1 - u * u)))
		return { x: side === "left" ? inset : w - inset, y }
	}
	if (kind === "component" && side === "left") {
		const tab = [h * 0.25, h * 0.65].some((top) => y >= top && y <= top + 14)
		return { x: tab ? 0 : 8, y }
	}
	if (kind === "component" && horizontal && x < 8) return { x, y: side === "top" ? h * 0.25 : h * 0.65 + 14 }
	if (kind === "api_endpoint" && side === "left" && Math.abs(y - h / 2) < 12) return { x: 12, y }
	if (kind === "service") {
		const inset = horizontal ? Math.max(0, 12 - x, x - (w - 12)) : Math.max(0, 12 - y, y - (h - 12))
		return horizontal ? { x, y: side === "top" ? inset : h - inset } : { x: side === "left" ? inset : w - inset, y }
	}
	return { x, y }
}
