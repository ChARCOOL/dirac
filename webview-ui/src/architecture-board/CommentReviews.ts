import type { CommentMutation, ResolvedArchitectureIdentity, ReviewComment, ReviewTarget } from "@shared/architecture"
import { BoardClient } from "./boardClient"

export const reviewKey = (identity: ResolvedArchitectureIdentity) => `${identity.taskId}/${identity.name}/${identity.version}`
export const targetKey = (target: ReviewTarget) => (target.kind === "diagram" ? "diagram" : `${target.kind}:${target.id}`)
export interface CommentDraft {
	id: string
	target: ReviewTarget
	text: string
	operation: "add_comment" | "edit_comment" | "delete_comment"
	status: "draft" | "saving" | "error"
	error?: string
}
export interface CommentReview {
	identity: ResolvedArchitectureIdentity
	comments?: ReviewComment[]
	drafts: CommentDraft[]
	frozen?: boolean
}

/** Panel-local composers survive version/target changes. Only explicit saves reach the review RPC. */
export class CommentReviews {
	private entries: CommentReview[] = []
	private epochs = new Map<string, number>()
	private inFlight = new Map<string, Promise<void>>()
	private listeners = new Set<() => void>()
	getSnapshot = () => this.entries
	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
	get(identity: ResolvedArchitectureIdentity) {
		return this.entries.find((entry) => reviewKey(entry.identity) === reviewKey(identity))
	}
	readEpoch = () => new Map(this.epochs)
	private bump(identity: ResolvedArchitectureIdentity) {
		const key = reviewKey(identity)
		this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1)
	}
	private update(entry: CommentReview) {
		this.entries = [...this.entries.filter((old) => reviewKey(old.identity) !== reviewKey(entry.identity)), entry]
		for (const listener of this.listeners) listener()
	}
	hydrate(identity: ResolvedArchitectureIdentity, comments: ReviewComment[] | undefined, epoch: Map<string, number>) {
		const key = reviewKey(identity)
		const entry = this.get(identity)
		if (
			entry?.frozen ||
			(epoch.get(key) ?? 0) !== (this.epochs.get(key) ?? 0) ||
			entry?.drafts.some((draft) => draft.status === "saving")
		)
			return
		this.update({ identity, comments, drafts: entry?.drafts ?? [] })
	}
	compose(identity: ResolvedArchitectureIdentity, target: ReviewTarget, text: string, comment?: ReviewComment) {
		const entry = this.get(identity)!
		const previous = entry.drafts.find((draft) =>
			comment
				? draft.id === comment.id
				: draft.operation === "add_comment" && targetKey(draft.target) === targetKey(target),
		)
		if (entry.frozen || previous?.status === "saving" || comment?.sent) return
		const draft: CommentDraft = {
			id: previous?.id ?? comment?.id ?? crypto.randomUUID(),
			target,
			text,
			operation: comment ? "edit_comment" : "add_comment",
			status: "draft",
		}
		this.update({ ...entry, drafts: [...entry.drafts.filter((old) => old.id !== draft.id), draft] })
	}
	discard(identity: ResolvedArchitectureIdentity, id: string) {
		const entry = this.get(identity)!
		if (entry.frozen || entry.drafts.find((draft) => draft.id === id)?.status === "saving") return
		this.update({ ...entry, drafts: entry.drafts.filter((draft) => draft.id !== id) })
	}
	delete(identity: ResolvedArchitectureIdentity, comment: ReviewComment) {
		const entry = this.get(identity)!
		if (entry.frozen || comment.sent || entry.drafts.some((draft) => draft.id === comment.id && draft.status === "saving"))
			return
		this.update({
			...entry,
			drafts: [
				...entry.drafts.filter((draft) => draft.id !== comment.id),
				{
					id: comment.id,
					target: comment.target,
					text: comment.text,
					operation: "delete_comment",
					status: "draft",
				},
			],
		})
		void this.save(identity, comment.id)
	}
	async submit(scope: ResolvedArchitectureIdentity[]) {
		if (scope.some((identity) => !this.get(identity)?.comments || this.get(identity)?.frozen))
			throw new Error("Refresh unavailable reviews or wait for the current submission")
		for (const identity of scope) this.update({ ...this.get(identity)!, frozen: true })
		try {
			await Promise.all(scope.map((identity) => this.inFlight.get(reviewKey(identity))))
			if (
				scope.some((identity) =>
					this.get(identity)!.drafts.some((draft) => draft.status === "error" || draft.operation !== "add_comment"),
				)
			)
				throw new Error(
					"Finish or discard failed saves and pending comment edits before sending feedback. New composer drafts are not submitted.",
				)
			const result = await BoardClient.submitFeedback(scope)
			for (const identity of scope) {
				const entry = this.get(identity)!
				this.bump(identity)
				this.update({ ...entry, comments: entry.comments!.map((comment) => ({ ...comment, sent: true })) })
			}
			return result
		} finally {
			for (const identity of scope) {
				this.bump(identity)
				this.update({ ...this.get(identity)!, frozen: false })
			}
		}
	}

	async save(identity: ResolvedArchitectureIdentity, id: string): Promise<void> {
		const key = reviewKey(identity)
		if (this.get(identity)?.frozen || this.inFlight.has(key)) return
		const request = this.persistDraft(identity, id)
		this.inFlight.set(key, request)
		try {
			await request
		} finally {
			this.inFlight.delete(key)
		}
	}

	private async persistDraft(identity: ResolvedArchitectureIdentity, id: string): Promise<void> {
		const entry = this.get(identity)!
		const draft = entry.drafts.find((draft) => draft.id === id)!
		// Serialize local comment mutations per version; presentation has its own queue at the same backend writer.
		if (!entry.comments || entry.drafts.some((draft) => draft.status === "saving")) return
		const mutation: CommentMutation =
			draft.operation === "add_comment"
				? { identity, operation: draft.operation, comment: { id, target: draft.target, text: draft.text } }
				: draft.operation === "edit_comment"
					? { identity, operation: draft.operation, commentId: id, text: draft.text }
					: { identity, operation: draft.operation, commentId: id }
		this.bump(identity)
		this.update({
			...entry,
			drafts: entry.drafts.map((old) => (old.id === id ? { ...draft, status: "saving", error: undefined } : old)),
		})
		try {
			const comments = await BoardClient.mutateComment(mutation)
			const current = this.get(identity)!
			this.bump(identity)
			this.update({ ...current, comments, drafts: current.drafts.filter((old) => old.id !== id) })
		} catch (error) {
			const current = this.get(identity)!
			this.bump(identity)
			this.update({
				...current,
				drafts: current.drafts.map((old) =>
					old.id === id
						? {
								...draft,
								status: "error",
								error: error instanceof Error ? error.message : String(error),
							}
						: old,
				),
			})
		}
	}
}
