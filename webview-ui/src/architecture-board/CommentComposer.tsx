import { useId } from "react"
import type { ResolvedArchitectureIdentity, ReviewTarget } from "@shared/architecture"
import { CommentReviews, targetKey, type CommentDraft, type CommentReview } from "./CommentReviews"

/** Shared by inline previews and the inspector; drafts belong to a version and target, not a view. */
export function CommentComposer({
	identity,
	target,
	review,
	reviews,
	compact = false,
}: {
	identity: ResolvedArchitectureIdentity
	target: ReviewTarget
	review?: CommentReview
	reviews: CommentReviews
	compact?: boolean
}) {
	const inputId = useId()
	const draft = review?.drafts.find(
		(draft) => draft.operation === "add_comment" && targetKey(draft.target) === targetKey(target),
	)
	const label = target.kind === "diagram" ? "General comment" : `${target.kind === "node" ? "Node" : "Edge"} comment`
	return (
		<div className={`comment-composer${compact ? " compact" : ""}`}>
			<label htmlFor={inputId}>{label}</label>
			<textarea
				id={inputId}
				rows={compact ? 2 : 3}
				placeholder="Leave a comment…"
				aria-describedby={`${inputId}-hint`}
				value={draft?.text ?? ""}
				disabled={!review || review.frozen || draft?.status === "saving"}
				onChange={(event) => reviews.compose(identity, target, event.target.value)}
			/>
			<p id={`${inputId}-hint`} className="comment-save-hint">
				{compact
					? "Save locally; Send Feedback submits."
					: "Save stores comments locally; only Send Feedback submits them. Unsaved drafts last while the board tab is open."}
			</p>
			{!review?.comments && <p role="alert">Saved comments unavailable. Refresh to retry; drafts are retained.</p>}
			{draft ? (
				<CommentDraftActions identity={identity} draft={draft} review={review} reviews={reviews} />
			) : compact ? (
				<button disabled>Save comment</button>
			) : null}
		</div>
	)
}

export function CommentDraftActions({
	identity,
	draft,
	review,
	reviews,
}: {
	identity: ResolvedArchitectureIdentity
	draft: CommentDraft
	review?: CommentReview
	reviews: CommentReviews
}) {
	const busy = review?.frozen || (review?.drafts.some((draft) => draft.status === "saving") ?? false)
	return (
		<>
			{draft.status === "saving" && <p role="status">Saving comment…</p>}
			{draft.error && <p role="alert">Comment not saved: {draft.error}</p>}
			<div className="comment-actions">
				<button
					disabled={busy || !review?.comments || (draft.operation !== "delete_comment" && !draft.text.trim())}
					onClick={() => void reviews.save(identity, draft.id)}>
					{draft.status === "error" ? "Retry comment save" : "Save comment"}
				</button>
				<button disabled={busy} onClick={() => reviews.discard(identity, draft.id)}>
					Discard draft
				</button>
			</div>
		</>
	)
}
