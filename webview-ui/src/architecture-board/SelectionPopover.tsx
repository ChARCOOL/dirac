import { useLayoutEffect, useRef, useState } from "react"
import { useStore, useViewport } from "@xyflow/react"
import { ArrowRight, X } from "lucide-react"
import type { ArchitectureDiagram, ResolvedArchitectureIdentity } from "@shared/architecture"
import type { CommentReviews, CommentReview } from "./CommentReviews"
import { CommentComposer } from "./CommentComposer"
import { countTargetComments } from "./CommentBadges"
import type { BoardTarget } from "./Inspector"
import type { BoardEdge } from "./flowGraph"
import { roundedRoute } from "./edgeGeometry"
import { NODE_KIND_LABELS } from "./nodeShapes"

/** Screen-space preview: inspecting a component must not resize or move its canvas. */
export function SelectionPopover({
	diagram,
	identity,
	review,
	reviews,
	target,
	edge,
	more,
	close,
}: {
	diagram: ArchitectureDiagram
	identity: ResolvedArchitectureIdentity
	review?: CommentReview
	reviews: CommentReviews
	target: BoardTarget
	edge?: BoardEdge
	more: () => void
	close: () => void
}) {
	const element = (target.kind === "node" ? diagram.nodes : diagram.edges).find((item) => item.id === target.id)!
	const kindLabel = "source" in element ? element.kind.replaceAll("_", " ") : NODE_KIND_LABELS[element.kind]
	const comments = countTargetComments(review?.comments ?? [], target)
	const anchorId = target.kind === "node" ? target.id : edge!.source
	const node = useStore((state) => state.nodeLookup.get(anchorId))!
	const width = useStore((state) => state.width)
	const height = useStore((state) => state.height)
	const viewport = useViewport()
	const container = useRef<HTMLDivElement>(null)
	const [popoverHeight, setPopoverHeight] = useState(220)
	useLayoutEffect(() => {
		const observer = new ResizeObserver(([entry]) => setPopoverHeight(entry.borderBoxSize[0].blockSize))
		observer.observe(container.current!)
		return () => observer.disconnect()
	}, [])
	const point = edge?.data?.route ? roundedRoute(edge.data.route).label : node.internals.positionAbsolute
	const x = point.x * viewport.zoom + viewport.x
	const y = point.y * viewport.zoom + viewport.y
	const anchorWidth = target.kind === "node" ? node.measured.width! * viewport.zoom : 0
	const popupWidth = Math.min(320, width - 16)
	const left = x + anchorWidth + popupWidth + 20 <= width ? x + anchorWidth + 12 : x - popupWidth - 12
	const names = new Map(diagram.nodes.map((item) => [item.id, item.label]))
	return (
		<div
			ref={container}
			role="dialog"
			aria-label={target.kind === "node" ? `${kindLabel} preview` : "Relationship preview"}
			className="selection-popover"
			tabIndex={-1}
			style={{
				width: popupWidth,
				maxHeight: Math.max(0, height - 16),
				left: Math.max(8, Math.min(left, width - popupWidth - 8)),
				top: Math.max(8, Math.min(y, height - popoverHeight - 8)),
			}}>
			<div className="popover-heading">
				<span className="inspector-eyebrow">{kindLabel}</span>
				<button aria-label="Close preview" title="Close preview (Escape)" onClick={close}>
					<X size={14} />
				</button>
			</div>
			<div className="popover-summary">
				<strong className="popover-title">{element.label ?? "Relationship"}</strong>
				{"source" in element && (
					<p className="popover-endpoints">
						{names.get(element.source)} → {names.get(element.target)}
					</p>
				)}
				{element.description && <p className="popover-description">{element.description}</p>}
				{target.kind === "node" && (
					<small>
						{diagram.edges.filter((item) => item.source === target.id || item.target === target.id).length} connected
						relationships
					</small>
				)}
			</div>
			<button className="popover-more" onClick={more}>
				Details & comments <ArrowRight size={14} />
			</button>
			<div className="inline-comment">
				<CommentComposer identity={identity} target={target} review={review} reviews={reviews} compact />
				{!!(comments.pending || comments.sent) && (
					<p className="inline-comment-count" role="status">
						{comments.pending} pending · {comments.sent} submitted · View in Details & comments
					</p>
				)}
			</div>
		</div>
	)
}
