import { useId, type CSSProperties } from "react";
import type { NodeKind } from "@shared/architecture";
import { nodeShape, NODE_KIND_LABELS } from "./nodeShapes";
import { useBoardStyle, StyleNodeAppearance, StyleLegendGlyph } from "./styles/StyleContext";

/** The same silhouette is used on the canvas and in the key; decoration never owns hit targets. */
export function NodeSilhouette({ kind, width = 248, height = 102 }: { kind: NodeKind; width?: number; height?: number }) {
	const style = useBoardStyle()
	const gradientId = `node-surface-${useId().replaceAll(":", "")}`
	// React Flow renders once before measuring the node.
	if (width === 0 || height === 0) return null
	const gradient = kind !== "group" && style.nodeGradient
	const shape = nodeShape(kind, { width, height }, style.geometry)
	return (
		<svg
			className="node-silhouette"
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio={kind === "actor" ? "xMidYMid meet" : "none"}
			aria-hidden="true"
			style={gradient ? ({ "--node-gradient": `url(#${gradientId})` } as CSSProperties) : undefined}>
			{gradient && (
				<defs>
					<linearGradient id={gradientId} x1="0" y1="0" x2="0.85" y2="1">
						<stop offset="0" stopColor="var(--node-surface-top)" />
						<stop offset="1" stopColor="var(--node-surface-bottom)" />
					</linearGradient>
				</defs>
			)}
			<path className="node-outline" d={shape.outline} />
			{shape.detail && <path className="node-structure" d={shape.detail} />}
		</svg>
	)
}

export function NodeShapeLegend({ kinds }: { kinds: NodeKind[] }) {
	return (
		<div className="kind-legend" aria-label="Node shapes">
			{[...new Set(kinds)].sort().map((kind) => (
				<span key={kind} className={`kind-${kind}`}>
					<span className="legend-silhouette">
						<StyleLegendGlyph
							kind={kind}
							width={248}
							height={102}
							fallback={
								<>
									<NodeSilhouette kind={kind} />
									<StyleNodeAppearance kind={kind} width={248} height={102} />
								</>
							}
						/>
					</span>
					{NODE_KIND_LABELS[kind]}
				</span>
			))}
		</div>
	)
}
