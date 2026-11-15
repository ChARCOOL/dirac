import type { PendingArchitectureReview, ResolvedArchitectureIdentity, ReviewState } from "@shared/architecture"
import { runArchitectureOperation } from "./architectureOperations"

/** Review-only failures never make semantic content unreadable or invent an empty saved review. */
export async function readBoardComments(
	readReview: (identity: ResolvedArchitectureIdentity) => Promise<ReviewState>,
	identity: ResolvedArchitectureIdentity,
	taskDirectory: string,
): Promise<{ commentsJson?: string; pendingReviewsJson?: string; historyError?: string; reviewError?: string }> {
	let commentsJson: string
	try {
		commentsJson = JSON.stringify((await readReview(identity)).comments)
	} catch (error) {
		return { reviewError: `Comments unavailable: ${error instanceof Error ? error.message : String(error)}` }
	}
	const pending: PendingArchitectureReview[] = []
	try {
		await runArchitectureOperation(taskDirectory, async (assertCurrent) => {
			for (let version = identity.version - 1; version > 0; version--) {
				assertCurrent()
				const review = await readReview({ ...identity, version })
				assertCurrent()
				const count = review.comments.filter((comment) => !comment.sent).length
				if (count) pending.push({ version, count })
			}
		})
		return { commentsJson, pendingReviewsJson: JSON.stringify(pending) }
	} catch (error) {
		return {
			commentsJson,
			pendingReviewsJson: JSON.stringify(pending),
			historyError: `Earlier pending-comment inventory incomplete: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}
