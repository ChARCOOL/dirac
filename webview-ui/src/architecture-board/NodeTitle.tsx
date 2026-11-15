import { useMemo } from "react"
import type { NodeKind } from "@shared/architecture"
import { measureBoardText } from "./measureText"
import { fitText, nodeTextRegions, TITLE_FONT_FAMILY, TITLE_FONT_SIZE, TITLE_LINE_HEIGHT } from "./textLayout"

/** Render exactly the lines that were measured, inside the silhouette's safe title rectangle. */
export function NodeTitle({
	label,
	kind,
	width,
	height,
	proposal = false,
	headerInset = 0,
}: {
	label: string
	kind: NodeKind
	width: number
	height: number
	proposal?: boolean
	headerInset?: number
}) {
	const box = nodeTextRegions(kind, { width, height }, proposal).title
	if (kind === "group") box.width = Math.max(0, box.width - headerInset)
	const fontSize = kind === "group" ? 16 : TITLE_FONT_SIZE
	const lineHeight = kind === "group" ? 24 : TITLE_LINE_HEIGHT
	const fit = useMemo(
		() =>
			fitText(
				label,
				// Leave one pixel for browser rasterization/rounding, and the group header's background padding.
				Math.max(0, box.width - (kind === "group" ? 24 : 1)),
				kind === "group" ? 1 : Math.min(4, Math.floor(box.height / lineHeight)),
				(text) => measureBoardText(text, `500 ${fontSize}px ${TITLE_FONT_FAMILY}`),
			),
		[label, box.width, box.height, kind, fontSize, lineHeight],
	)
	return (
		<strong
			className="node-title fitted-title"
			aria-label={label}
			data-truncated={fit.truncated || undefined}
			dir="auto"
			style={{ left: box.x, top: box.y, width: box.width, height: box.height, fontSize, lineHeight: `${lineHeight}px` }}>
			{fit.lines.map((line, index) => (
				<span className="title-line" key={index}>
					{line || "\u00a0"}
				</span>
			))}
		</strong>
	)
}
