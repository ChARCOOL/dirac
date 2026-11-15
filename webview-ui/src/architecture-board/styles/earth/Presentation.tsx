import type { NodeKind } from "@shared/architecture"
import { NODE_KIND_LABELS } from "../../nodeShapes"
import type { NodeContentProps } from "../StyleContext"

const glyphs: Record<Exclude<NodeKind, "group">, string> = {
	class: "{ }",
	function: "ƒ",
	database: "≡",
	api_endpoint: "↔",
	service: "◇",
	component: "⊞",
	state: "▢",
	actor: "○",
}

export function NodeContent({ kind, title }: NodeContentProps) {
	if (kind === "group") return <>{title}</>
	return (
		<>
			<div className="earth-kind">
				<span className="earth-glyph" aria-hidden="true">{glyphs[kind]}</span>
				{NODE_KIND_LABELS[kind]}
			</div>
			<div className="earth-title">{title}</div>
		</>
	)
}

export function GroupHeader({ title }: NodeContentProps) {
	return <>{title}</>
}
