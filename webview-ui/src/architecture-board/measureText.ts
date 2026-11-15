import type { ArchitectureDiagram } from "@shared/architecture"
import { boardNodeSizes } from "./styles/boardGeometry"
import { sizeNodeForText, TITLE_FONT } from "./textLayout"

let context: CanvasRenderingContext2D | undefined
const widths = new Map<string, number>()

/** Browser font metrics only; the layout worker receives finished dimensions, never DOM access. */
export function measureBoardText(text: string, font = TITLE_FONT): number {
	const key = `${font}\n${text}`
	const cached = widths.get(key)
	if (cached !== undefined) return cached
	if (!context) {
		const canvas = document.createElement("canvas")
		const created = canvas.getContext("2d")
		if (!created) throw new Error("Architecture text measurement requires a 2D canvas")
		context = created
	}
	context.font = font
	const metrics = context.measureText(text)
	const width = Math.max(metrics.width, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight)
	if (widths.size >= 4096) widths.clear()
	widths.set(key, width)
	return width
}

export function measureNodeSizes(diagram: ArchitectureDiagram) {
	return Object.fromEntries(
		diagram.nodes.flatMap((node) =>
			node.kind === "group"
				? []
				: [[node.id, sizeNodeForText(node.kind, node.label, boardNodeSizes[node.kind], !!node.change, measureBoardText)]],
		),
	)
}

/** Load both bundled subsets before initial sizing; failures remain visible instead of silently changing metrics. */
export async function loadBoardFonts() {
	await document.fonts.load(TITLE_FONT, "AĄ")
	await document.fonts.ready
	widths.clear()
}
