import { useMemo, useState, type ReactNode } from "react"
import { PanelRight } from "lucide-react"
import { ReactFlowProvider } from "@xyflow/react"
import type { ArchitectureDiagram, ArchitecturePresentation } from "@shared/architecture"
import type { ArchitectureBoardPane } from "@shared/proto/dirac/architecture"
import { DiagramCanvas } from "./DiagramCanvas"
import { DiagramRenderBoundary } from "./DiagramRenderBoundary"
import type { PresentationSaves } from "./PresentationSaves"
import type { CommentReviews, CommentReview } from "./CommentReviews"

export function DiagramPane({
	pane,
	taskId,
	side,
	comparison,
	fullscreen = false,
	saves,
	reviews,
	review,
	presentationControls,
	utilityControls,
	versionControls,
	overviewRequest = 0,
}: {
	pane: ArchitectureBoardPane
	taskId: string
	side: "Left" | "Right"
	comparison?: boolean
	fullscreen?: boolean
	saves: PresentationSaves
	reviews: CommentReviews
	review?: CommentReview
	presentationControls?: ReactNode
	utilityControls?: ReactNode
	versionControls?: ReactNode
	overviewRequest?: number
}) {
	const [paneOverviewRequest, setPaneOverviewRequest] = useState(0)
	const diagram = useMemo(() => JSON.parse(pane.diagramJson) as ArchitectureDiagram, [pane.diagramJson])
	const presentation = useMemo(
		() => (pane.presentationJson ? (JSON.parse(pane.presentationJson) as ArchitecturePresentation) : undefined),
		[pane.presentationJson],
	)
	const identity = useMemo(() => ({ taskId, name: pane.name, version: pane.version }), [taskId, pane.name, pane.version])
	return (
		<section className="diagram-pane" aria-label={`${side} version ${pane.version}`}>
			{comparison && (
				<div className="diagram-heading">
					<div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, whiteSpace: "nowrap" }}>
						{versionControls ?? <span className="version-badge">Version {pane.version}</span>}
					</div>
					<span className="comparison-side">{side}</span>
					<h2 title={pane.title}>{pane.title}</h2>
					<button
						className="diagram-overview-button"
						aria-label="Diagram & comments"
						title="Diagram & comments"
						onClick={() => setPaneOverviewRequest((value) => value + 1)}>
						<PanelRight size={14} aria-hidden="true" />
						<span>Diagram & comments</span>
					</button>
				</div>
			)}
			{pane.reviewError && (
				<p role="alert">
					{pane.reviewError} Changes remain local until saving succeeds. The existing sidecar will not be overwritten.
				</p>
			)}
			{pane.historyError && <p role="alert">{pane.historyError}</p>}
			{pane.feedbackWarning && <p role="status">{pane.feedbackWarning}</p>}
			<DiagramRenderBoundary diagram={diagram}>
				<ReactFlowProvider>
					<DiagramCanvas
						diagram={diagram}
						summary={pane.summary}
						fullscreen={fullscreen}
						presentationControls={presentationControls}
						utilityControls={utilityControls}
						overviewRequest={comparison ? paneOverviewRequest : overviewRequest}
						identity={identity}
						presentation={presentation}
						saves={saves}
						review={review}
						reviews={reviews}
					/>
				</ReactFlowProvider>
			</DiagramRenderBoundary>
		</section>
	)
}
