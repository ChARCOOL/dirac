import { ArchitectureStorage } from "@core/architecture/ArchitectureStorage"
import { runArchitectureOperation } from "@core/architecture/architectureOperations"
import { formatArchitectureFeedback } from "@core/architecture/formatArchitectureFeedback"
import type { DiracMessage } from "@shared/ExtensionMessage"
import type { ArchitectureFeedbackCommentIdentity, ResolvedArchitectureIdentity } from "@shared/architecture"
import { DiracMessageType, SteeringTranscriptStatus } from "@shared/ExtensionMessage"
import type { ArchitectureFeedbackInput } from "./architectureFeedbackInput"

const reference = (identity: ArchitectureFeedbackCommentIdentity) =>
	`architecture:${JSON.stringify([identity.taskId, identity.name, identity.version, identity.commentId])}`

/** Explicit board operations only. The persisted conversation is the delivery record. */
export class ArchitectureFeedbackDelivery {
	private accepting = new Set<string>()
	private mutations = new Map<string, Promise<unknown>>()
	constructor(
		private readonly directory: (taskId: string) => string,
		private readonly readConversation: (taskId: string) => Promise<readonly DiracMessage[]>,
	) {}

	async mutate<T>(identity: ResolvedArchitectureIdentity, action: () => Promise<T>): Promise<T> {
		if (this.accepting.has(identity.taskId))
			throw new Error("Feedback submission is being accepted; comments are temporarily frozen")
		const previous = this.mutations.get(identity.taskId) ?? Promise.resolve()
		const result = previous
			.catch(() => {})
			.then(async () => {
				await this.reconcile(identity)
				return action()
			})
		this.mutations.set(identity.taskId, result)
		try {
			return await result
		} finally {
			if (this.mutations.get(identity.taskId) === result) this.mutations.delete(identity.taskId)
		}
	}

	private async delivered(taskId: string): Promise<Set<string>> {
		const messages = await this.readConversation(taskId)
		return new Set(
			messages.flatMap((message) =>
				message.content.type === DiracMessageType.MARKDOWN && message.content.role === "user"
					? (message.content.contextualInput?.references ?? [])
					: [],
			),
		)
	}

	/** One transcript snapshot per explicit board read, shared by its panes and historical inventory.
	 * A saved source reference proves persistence, not consumption by the running conversation.
	 */
	createReconciledReviewReader(taskId: string) {
		let snapshot: Promise<readonly DiracMessage[]> | undefined
		const messages = () => (snapshot ??= this.readConversation(taskId))
		let delivered: Promise<Set<string>> | undefined
		const storage = new ArchitectureStorage(taskId, this.directory(taskId))
		return {
			read: async (identity: ResolvedArchitectureIdentity) => {
				delivered ??= messages().then(
					(items) =>
						new Set(
							items.flatMap((message) =>
								message.content.type === DiracMessageType.MARKDOWN && message.content.role === "user"
									? (message.content.contextualInput?.references ?? [])
									: [],
							),
						),
				)
				await this.reconcile(identity, delivered)
				return storage.readReview(identity)
			},
			warning: async (identity: ResolvedArchitectureIdentity): Promise<string | undefined> => {
				const prefix = `architecture:${JSON.stringify([identity.taskId, identity.name, identity.version]).slice(0, -1)},`
				const pending = (await messages()).some(
					(message) =>
						message.content.type === DiracMessageType.MARKDOWN &&
						message.content.role === "user" &&
						message.content.steering?.status !== SteeringTranscriptStatus.SENT &&
						message.content.contextualInput?.references.some((item) => item.startsWith(prefix)),
				)
				return pending
					? "Feedback is saved in the conversation but consumption is not yet confirmed. Sent comments must not be resent. If the conversation is not processing this feedback, resume the owning conversation through its normal flow; refreshing this board does not resume it."
					: undefined
			},
		}
	}

	private async reconcile(identity: ResolvedArchitectureIdentity, references?: Promise<Set<string>>): Promise<void> {
		const { taskId } = identity
		await runArchitectureOperation(this.directory(taskId), async (assertCurrent) => {
			const delivered = await (references ?? this.delivered(taskId))
			if (!delivered.size) return
			// Reconcile only the requested revision; corrupt historical files must not block healthy reviews.
			const storage = new ArchitectureStorage(taskId, this.directory(taskId))
			assertCurrent()
			const review = await storage.readReview(identity)
			const pending = review.comments.filter(
				(comment) => !comment.sent && delivered.has(reference({ ...identity, commentId: comment.id })),
			)
			assertCurrent()
			if (pending.length)
				await storage.mutateReview({
					identity,
					operation: "mark_sent",
					commentIds: pending.map((comment) => comment.id),
				})
		})
	}

	async submit(
		scope: ResolvedArchitectureIdentity[],
		input: ArchitectureFeedbackInput,
		assertCurrent: () => void,
	): Promise<{ submittedCount: number; warning?: string }> {
		const taskId = scope[0].taskId
		if (this.accepting.has(taskId)) throw new Error("Feedback submission is already being accepted; refresh before retrying")
		return runArchitectureOperation(this.directory(taskId), async (assertAlive) => {
			this.accepting.add(taskId)
			try {
				const check = () => {
					assertAlive()
					assertCurrent()
				}
				await this.mutations.get(taskId)
				check()
				const storage = new ArchitectureStorage(taskId, this.directory(taskId))
				await storage.waitForPendingWrites(scope[0].name)
				for (const identity of scope) await this.reconcile(identity)
				const snapshots = await Promise.all(
					scope.map(async (identity) => ({
						identity,
						diagram: (await storage.fetchDiagram(identity.name, identity.version)).diagram,
						comments: (await storage.readReview(identity)).comments.filter((comment) => !comment.sent),
					})),
				)
				const references = snapshots.flatMap(({ identity, comments }) =>
					comments.map((comment) => reference({ ...identity, commentId: comment.id })),
				)
				if (!references.length) return { submittedCount: 0 }
				const text = formatArchitectureFeedback(snapshots)
				check()
				const acceptance = await input.submit({ text, references }, check)
				// No conversation lock is held across optional sidecar synchronization.
				try {
					for (const identity of scope) await this.reconcile(identity)
					return { submittedCount: references.length, warning: acceptance.warning }
				} catch (error) {
					return {
						submittedCount: references.length,
						warning: `Feedback persisted in the conversation, but board synchronization failed: ${error instanceof Error ? error.message : String(error)}. Refresh to reconcile; do not resend. ${acceptance.warning ?? ""}`,
					}
				}
			} finally {
				this.accepting.delete(taskId)
			}
		})
	}
}
