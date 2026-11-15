import type { EdgeKind } from "@shared/architecture"
import { useBoardStyle } from "./styles/StyleContext"

const relationships = [
	["api_call", "Calls"],
	["data_flow", "Data flow"],
	["dependency", "Dependency"],
	["aggregation", "Ownership"],
	["transition", "Transition"],
	["message", "Message"],
] as const

/** The legend repeats the canvas patterns and endpoints, not just its colors. */
export function RelationshipLegend({ kinds }: { kinds?: readonly EdgeKind[] }) {
	const style = useBoardStyle()
	const visible = relationships.filter(([kind]) => !kinds || kinds.includes(kind))
	if (!visible.length) return null
	return (
		<div className="relationship-legend" aria-label="Relationship colors and line styles">
			{visible.map(([kind, label]) => {
				const dash = kind === "message" ? style.messageDash : kind === "data_flow" ? style.dataDash : kind === "dependency" ? style.dependencyDash : undefined
				return (
					<span key={kind}>
						<svg className={`legend-line edge-${kind}`} viewBox="0 0 36 12" aria-hidden="true" style={{ color: `var(--board-edge-${kind})` }}>
							<path d={kind === "aggregation" ? "M 12 6 H 35" : "M 1 6 H 32"} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeDasharray={dash?.join(" ")} />
							{kind === "aggregation" ? (
								<path d="M 1 6 L 7 2 L 13 6 L 7 10 Z" fill="var(--board-bg)" stroke="currentColor" strokeWidth={1.4} />
							) : kind === "transition" ? (
								<path d="M 26 2 L 34 6 L 26 10" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
							) : (
								<path d="M 26 2 L 35 6 L 26 10 L 28 6 Z" fill="currentColor" />
							)}
						</svg>
						{label}
					</span>
				)
			})}
		</div>
	)
}
