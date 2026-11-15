import type { BoardEdge, BoardNode } from "../flowGraph"

export interface ExportSnapshot {
	nodes: BoardNode[]
	edges: BoardEdge[]
}

/** Take a value snapshot, retaining layout and authored changes but no transient interaction/review state. */
export function createExportSnapshot(nodes: BoardNode[], edges: BoardEdge[], labels: boolean): ExportSnapshot {
	if (!nodes.length) throw new Error("There are no diagram elements to copy.")
	if (nodes.some((node) => node.dragging)) throw new Error("Finish moving elements before copying the image.")
	if (edges.some((edge) => (edge.data?.route?.length ?? 0) < 2))
		throw new Error("Wait for diagram routing to finish before copying the image.")
	return structuredClone({
		nodes: nodes.map((node) => ({
			...node,
			selected: false,
			dragging: false,
			draggable: false,
			focusable: false,
			data: { ...node.data, dimmed: false, comments: undefined },
		})),
		edges: edges.map((edge) => ({
			...edge,
			selected: false,
			focusable: false,
			data: { ...edge.data!, showLabel: labels, emphasized: false, dimmed: false, comments: undefined },
		})),
	})
}

export interface ImageBounds {
	x: number
	y: number
	width: number
	height: number
}

/** Fixed budgets avoid the browser's silent canvas downscaling or partial exports. */
export function imageDimensions(bounds: ImageBounds) {
	const width = Math.ceil(bounds.width + 64)
	const height = Math.ceil(bounds.height + 64)
	const pixelRatio = 2
	if (![bounds.x, bounds.y, width, height].every(Number.isFinite) || bounds.width < 0 || bounds.height < 0)
		throw new Error("The diagram has invalid image bounds.")
	if (width * pixelRatio > 8192 || height * pixelRatio > 8192 || width * height * pixelRatio ** 2 > 16_000_000)
		throw new Error(
			"This diagram is too large for a full-resolution image (maximum 8192px per side and 16 megapixels). Copy a smaller diagram; nothing was cropped.",
		)
	return { width, height, pixelRatio, viewport: { x: 32 - bounds.x, y: 32 - bounds.y, zoom: 1 } }
}

/** Absolute node/route bounds catch oversized diagrams before mounting an export renderer. */
export function snapshotBounds({ nodes, edges }: ExportSnapshot): ImageBounds {
	const origins = new Map<string, { x: number; y: number }>()
	let left = Infinity,
		top = Infinity,
		right = -Infinity,
		bottom = -Infinity
	const include = (x: number, y: number) => {
		left = Math.min(left, x)
		top = Math.min(top, y)
		right = Math.max(right, x)
		bottom = Math.max(bottom, y)
	}
	for (const node of nodes) {
		const parent = node.parentId ? origins.get(node.parentId)! : { x: 0, y: 0 }
		const origin = { x: parent.x + node.position.x, y: parent.y + node.position.y }
		origins.set(node.id, origin)
		include(origin.x, origin.y)
		include(origin.x + Number(node.style!.width), origin.y + Number(node.style!.height))
	}
	for (const edge of edges) for (const point of edge.data!.route!) include(point.x, point.y)
	return { x: left, y: top, width: right - left, height: bottom - top }
}
