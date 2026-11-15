import type { ArchitectureSelection, PendingArchitectureReview, ResolvedArchitectureIdentity } from "@shared/architecture"
import type { ArchitectureBoardView } from "@shared/proto/dirac/architecture"
import { reviewKey, type CommentReview } from "./CommentReviews"

export function ReviewSummary({
	taskId,
	view,
	reviews,
	navigate,
}: {
	taskId: string
	view: ArchitectureBoardView
	reviews: CommentReview[]
	navigate: (selection: ArchitectureSelection) => void
}) {
	const displayed = new Set(view.panes.map((pane) => reviewKey({ taskId, name: pane.name, version: pane.version })))
	const scoped = [...displayed].map((key) => reviews.find((entry) => reviewKey(entry.identity) === key))
	const count = scoped.reduce((total, entry) => total + (entry?.comments?.filter((comment) => !comment.sent).length ?? 0), 0)
	const pending = new Map<string, { identity: ResolvedArchitectureIdentity; count: number }>()
	for (const pane of view.panes) {
		for (const previous of JSON.parse(pane.pendingReviewsJson ?? "[]") as PendingArchitectureReview[]) {
			const identity = { taskId, name: pane.name, version: previous.version }
			pending.set(reviewKey(identity), { identity, count: previous.count })
		}
	}
	for (const entry of reviews) {
		if (entry.comments)
			pending.set(reviewKey(entry.identity), {
				identity: entry.identity,
				count: entry.comments.filter((comment) => !comment.sent).length,
			})
	}
	const open = (identity: ResolvedArchitectureIdentity) => navigate({ ...identity, mode: "exact" })
	return (
		<div className="review-summary">
			<p className="review-scope-status" role="status">
				Pending comments in displayed scope: {scoped.some((entry) => !entry?.comments) ? "unavailable" : count}. Feedback
				stays local until you explicitly select Send Feedback.
			</p>
			{[...pending.values()]
				.filter((entry) => entry.count > 0 && !displayed.has(reviewKey(entry.identity)))
				.map((entry) => (
					<p key={reviewKey(entry.identity)}>
						Pending feedback on another version:{" "}
						<button onClick={() => open(entry.identity)}>
							{entry.identity.name} v{entry.identity.version} ({entry.count} pending)
						</button>
					</p>
				))}
			{reviews
				.filter((entry) => entry.drafts.length > 0)
				.map((entry) => (
					<p
						key={reviewKey(entry.identity)}
						className={
							displayed.has(reviewKey(entry.identity)) && !entry.drafts.some((draft) => draft.status === "error")
								? "review-scope-status"
								: undefined
						}
						role={entry.drafts.some((draft) => draft.status === "error") ? "alert" : "status"}>
						{entry.identity.name} v{entry.identity.version}: {entry.drafts.length} unsaved comment draft(s)
						{entry.drafts.some((draft) => draft.status === "error") && " — comment save failed"}.{" "}
						{!displayed.has(reviewKey(entry.identity)) && (
							<button onClick={() => open(entry.identity)}>Return to drafts</button>
						)}
					</p>
				))}
		</div>
	)
}
