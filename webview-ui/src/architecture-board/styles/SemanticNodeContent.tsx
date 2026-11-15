import { NODE_KIND_LABELS } from "../nodeShapes"
import type { NodeContentProps } from "./StyleContext"

/** Shared semantic hierarchy, styled by each directory; never supplies invented content. */
export function SemanticNodeContent({ kind, title }: NodeContentProps) {
	return (
		<>
			{(kind === "state" || kind === "actor") && (
				<span className="interaction-kind">
					<span aria-hidden="true">{kind === "actor" ? "○" : "▢"}</span> {NODE_KIND_LABELS[kind]}
				</span>
			)}
			{title}
			{kind === "class" && (
				<span className="class-header-glyph" aria-hidden="true">
					{"{ }"}
				</span>
			)}
		</>
	)
}

export function FrameHeader({ title }: NodeContentProps) {
	return <>{title}</>
}
