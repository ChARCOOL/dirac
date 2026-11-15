import type { ReviewComment, ReviewTarget } from "@shared/architecture"
import { targetKey } from "./CommentReviews"

export interface CommentCounts {
	pending: number
	sent: number
}
export function countTargetComments(comments: ReviewComment[], target: ReviewTarget): CommentCounts {
	const matching = comments.filter((comment) => targetKey(comment.target) === targetKey(target))
	return {
		pending: matching.filter((comment) => !comment.sent).length,
		sent: matching.filter((comment) => comment.sent).length,
	}
}
export function CommentBadges({ counts }: { counts?: CommentCounts }) {
	if (!counts || (!counts.pending && !counts.sent)) return null
	return (
		<span className="comment-badges">
			{counts.pending > 0 && <span>Pending: {counts.pending}</span>}
			{counts.sent > 0 && <span>Submitted: {counts.sent}</span>}
		</span>
	)
}
