import { useId } from "react"
import type { ResolvedArchitectureIdentity, ReviewTarget } from "@shared/architecture"
import { CommentReviews, targetKey, type CommentReview } from "./CommentReviews"
import { CommentComposer, CommentDraftActions } from "./CommentComposer"

export function CommentThread({
	identity,
	target,
	review,
	reviews,
}: {
	identity: ResolvedArchitectureIdentity
	target: ReviewTarget
	review?: CommentReview
	reviews: CommentReviews
}) {
	const inputId = useId()
	const comments = review?.comments?.filter((comment) => targetKey(comment.target) === targetKey(target)) ?? []
	const busy = review?.frozen || (review?.drafts.some((draft) => draft.status === "saving") ?? false)
	const unavailable = !review?.comments
	const label = target.kind === "diagram" ? "General comment" : `${target.kind === "node" ? "Node" : "Edge"} comment`
	return (
		<section className="comment-thread" aria-label={`${label}s version ${identity.version}`}>
			<h4>{target.kind === "diagram" ? "General comments" : "Element comments"}</h4>
			<ul>
				{comments.map((comment) => {
					const draft = review?.drafts.find((draft) => draft.id === comment.id)
					return (
						<li key={comment.id}>
							<strong>{comment.sent ? "Submitted" : "Pending"}</strong>
							<p className="comment-text">{comment.text}</p>
							{comment.sent ? (
								<p>Submitted comments are immutable. Add a new comment to correct this one.</p>
							) : draft ? (
								<>
									{draft.operation !== "delete_comment" && (
										<>
											<label htmlFor={`${inputId}-${comment.id}`}>Edit {label.toLowerCase()}</label>
											<textarea
												id={`${inputId}-${comment.id}`}
												value={draft.text}
												disabled={busy}
												onChange={(event) =>
													reviews.compose(identity, target, event.target.value, comment)
												}
											/>
										</>
									)}
									{draft.operation === "delete_comment" && <p>Deletion not yet confirmed.</p>}
									<CommentDraftActions identity={identity} draft={draft} review={review} reviews={reviews} />
								</>
							) : (
								<>
									<button
										disabled={busy || unavailable}
										onClick={() => reviews.compose(identity, target, comment.text, comment)}>
										Edit comment
									</button>
									<button disabled={busy || unavailable} onClick={() => reviews.delete(identity, comment)}>
										Delete comment
									</button>
								</>
							)}
						</li>
					)
				})}
			</ul>
			<CommentComposer identity={identity} target={target} review={review} reviews={reviews} />
		</section>
	)
}
