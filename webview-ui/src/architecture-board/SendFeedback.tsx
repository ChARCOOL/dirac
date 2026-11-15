import { useRef, useState, useSyncExternalStore } from "react"
import type { ArchitectureBoardView } from "@shared/proto/dirac/architecture"
import { CommentReviews, reviewKey } from "./CommentReviews"

export function SendFeedback({
	taskId,
	view,
	reviews,
	disabled,
	refresh,
}: {
	taskId: string
	view: ArchitectureBoardView
	reviews: CommentReviews
	disabled: boolean
	refresh: () => Promise<void>
}) {
	useSyncExternalStore(reviews.subscribe, reviews.getSnapshot)
	const [busy, setBusy] = useState(false)
	const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
	const accepting = useRef(false)
	const scope = [
		...new Map(
			view.panes.map(({ name, version }) => {
				const identity = { taskId, name, version }
				return [reviewKey(identity), identity]
			}),
		).values(),
	]
	const entries = scope.map((identity) => reviews.get(identity))
	const count = entries.reduce((total, entry) => total + (entry?.comments?.filter((comment) => !comment.sent).length ?? 0), 0)
	const send = async () => {
		if (accepting.current) return
		accepting.current = true
		setBusy(true)
		setNotice(undefined)
		try {
			const result = await reviews.submit(scope)
			setNotice({
				text:
					result.warning ??
					(result.submittedCount
						? `${result.submittedCount} comment(s) submitted to the owning conversation.`
						: "No pending feedback remains in this scope."),
				error: !!result.warning,
			})
		} catch (error) {
			setNotice({
				text: `Feedback submission not confirmed: ${error instanceof Error ? error.message : String(error)}. Reload board reconciles persisted feedback before any retry.`,
				error: true,
			})
		} finally {
			accepting.current = false
			setBusy(false)
			await refresh()
		}
	}
	return (
		<section className="feedback-submission" aria-label="Feedback submission">
			<button
				className="primary-button"
				title="Send saved comments from the displayed versions to the owning conversation"
				disabled={disabled || busy || !count || entries.some((entry) => !entry?.comments || entry.frozen)}
				onClick={() => void send()}>
				{busy ? "Submitting feedback…" : count ? `Send Feedback · ${count}` : "Send Feedback"}
			</button>
			{notice && (
				<p role={notice.error ? "alert" : "status"}>
					{notice.text} <button onClick={() => setNotice(undefined)}>Dismiss</button>
				</p>
			)}
		</section>
	)
}
