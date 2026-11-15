import { ArchitectureStorage } from "@core/architecture/ArchitectureStorage"
import { subscribeArchitecturePublications } from "@core/architecture/architecturePublications"
import { runArchitectureOperation } from "@core/architecture/architectureOperations"
import { resolveArchitectureSelection } from "@core/architecture/resolveArchitectureSelection"
import { readBoardPresentation } from "@core/architecture/readBoardPresentation"
import { readBoardComments } from "@core/architecture/readBoardComments"
import { parseCommentRequest } from "./commentRequests"
import type { ArchitectureDiagram, ResolvedArchitectureIdentity } from "@shared/architecture"
import { codeRequestSchema, parsePresentationRequest } from "./boardRequests"
import { resolveArchitectureCode, type ArchitectureWorkspace } from "./resolveArchitectureCode"
import { getHostCapabilities } from "@hosts/host-capabilities"
import type { ArchitectureSelection } from "@shared/architecture"
import type { ArchitecturePanel } from "@shared/architecture/panel"
import { parseArchitectureSelection } from "@shared/architecture/selection"
import type { ArchitectureBoardRequest, ArchitectureBoardView } from "@shared/proto/dirac/architecture"
import type { ExtensionMessage } from "@shared/ExtensionMessage"
import type { WebviewMessage } from "@shared/WebviewMessage"
import { ArchitectureFeedbackDelivery } from "./ArchitectureFeedbackDelivery"
import type { ArchitectureFeedbackInput } from "./architectureFeedbackInput"
import { feedbackRequestSchema } from "./feedbackRequests"

interface BoardSession {
	selection: ArchitectureSelection
	panel?: ArchitecturePanel
	creating?: Promise<ArchitecturePanel>
	unsubscribe: () => void
	generation: number
	served: Set<string>
	displayed?: ResolvedArchitectureIdentity[]
	workspace?: ArchitectureWorkspace
}

const sessionKey = (taskId: string, name: string) => JSON.stringify([taskId, name])

/** Task-owned navigation/review. Only explicit feedback delegates to conversation input. */
export class ArchitectureBoardController {
	private readonly sessions = new Map<string, BoardSession>()
	private readonly pendingOpens = new Map<string, symbol>()
	private disposed = false
	private readonly feedback: ArchitectureFeedbackDelivery

	constructor(
		private readonly assertOwner: (taskId: string) => void,
		private readonly resolveTaskDirectory: (taskId: string) => string,
		private readonly resolveWorkspace?: (taskId: string) => ArchitectureWorkspace | undefined,
		private readonly conversation?: {
			input(taskId: string): ArchitectureFeedbackInput
			read(taskId: string): Promise<readonly import("@shared/ExtensionMessage").DiracMessage[]>
		},
	) {
		this.feedback = new ArchitectureFeedbackDelivery(resolveTaskDirectory, (taskId) =>
			conversation ? conversation.read(taskId) : Promise.resolve([]),
		)
	}

	async open(input: unknown): Promise<void> {
		const selection = parseArchitectureSelection(input)
		this.assertCurrentOwner(selection.taskId)
		const viewer = getHostCapabilities().architectureViewer
		if (!viewer) throw new Error("Architecture viewer is unavailable on this host")
		const directory = this.resolveTaskDirectory(selection.taskId)
		const key = sessionKey(selection.taskId, selection.name)
		const request = Symbol()
		this.pendingOpens.set(key, request)
		const assertLatestRequest = () => {
			if (this.pendingOpens.get(key) !== request)
				throw new Error("Architecture navigation was superseded by a newer request")
		}
		try {
			await runArchitectureOperation(directory, async (assertCurrent) => {
				await viewer.prepare()
				await resolveArchitectureSelection(selection, new ArchitectureStorage(selection.taskId, directory))
				assertCurrent()
				this.assertCurrentOwner(selection.taskId)
				assertLatestRequest()
				let session = this.sessions.get(key)
				if (!session) {
					session = {
						selection,
						generation: 0,
						unsubscribe: () => undefined,
						served: new Set(),
						workspace: this.resolveWorkspace?.(selection.taskId),
					}
					this.sessions.set(key, session)
					const owned = session
					session.unsubscribe = subscribeArchitecturePublications(async (identity) => {
						if (identity.taskId !== selection.taskId || identity.name !== owned.selection.name) return
						// Fixed snapshots also refresh availability metadata, never their selection.
						await owned.panel?.refresh()
					})
				}
				session.selection = selection
				session.generation++
				const owned = session
				if (!session.panel && !session.creating) {
					session.creating = viewer
						.createPanel({
							taskId: selection.taskId,
							name: selection.name,
							onMessage: (message, post) => this.receive(selection.taskId, owned, message, post),
							onDispose: () => this.remove(selection.taskId, owned),
						})
						.then((panel) => {
							try {
								assertCurrent()
								this.assertSession(selection.taskId, owned)
							} catch (error) {
								panel.dispose()
								throw error
							}
							owned.panel = panel
							return panel
						})
						.catch((error) => {
							this.remove(selection.taskId, owned)
							throw error
						})
				}
				const panel = session.panel ?? (await session.creating!)
				assertCurrent()
				this.assertSession(selection.taskId, owned)
				assertLatestRequest()
				panel.reveal()
				await panel.refresh()
			})
		} catch (error) {
			const session = this.sessions.get(key)
			if (this.pendingOpens.get(key) === request && session && !session.panel) this.remove(selection.taskId, session)
			throw error
		} finally {
			if (this.pendingOpens.get(key) === request) this.pendingOpens.delete(key)
		}
	}

	async read(input: ArchitectureBoardRequest, panelSession?: BoardSession): Promise<ArchitectureBoardView> {
		if (
			!input ||
			typeof input.taskId !== "string" ||
			(input.viewLatest !== undefined && typeof input.viewLatest !== "boolean") ||
			Object.keys(input).some((key) => !["taskId", "viewLatest", "selection"].includes(key))
		)
			throw new Error("Invalid architecture board request")
		const session = panelSession ?? this.findSession(input.taskId, input.selection?.name)
		if (!session) throw new Error("Architecture board is closed; reopen its transcript card")
		this.assertSession(input.taskId, session)
		if (input.selection) {
			const selection = parseArchitectureSelection(input.selection)
			if (selection.taskId !== input.taskId || selection.name !== session.selection.name || input.viewLatest)
				throw new Error("Invalid board navigation ownership")
			session.selection = selection
			session.generation++
		}
		if (input.viewLatest) {
			session.selection = { taskId: input.taskId, name: session.selection.name, mode: "latest" }
			session.generation++
		}
		const generation = session.generation
		const readReview = this.feedback.createReconciledReviewReader(input.taskId)
		const view = await resolveArchitectureSelection(
			session.selection,
			new ArchitectureStorage(input.taskId, this.resolveTaskDirectory(input.taskId)),
		)
		await Promise.all(
			view.panes.map(async (pane) => {
				const identity = { taskId: input.taskId, name: pane.name, version: pane.version }
				Object.assign(
					pane,
					await readBoardPresentation(
						new ArchitectureStorage(input.taskId, this.resolveTaskDirectory(input.taskId)),
						identity,
						JSON.parse(pane.diagramJson) as ArchitectureDiagram,
						this.resolveTaskDirectory(input.taskId),
					),
				)
				Object.assign(pane, await readBoardComments(readReview.read, identity, this.resolveTaskDirectory(input.taskId)))
				// A failed transcript read is already surfaced by readBoardComments as reviewError.
				if (pane.commentsJson !== undefined) pane.feedbackWarning = await readReview.warning(identity)
			}),
		)
		this.assertSession(input.taskId, session)
		if (generation !== session.generation) throw new Error("Architecture selection changed; refresh the board")
		for (const pane of view.panes) session.served.add(`${pane.name}:${pane.version}`)
		session.displayed = view.panes.map(({ name, version }) => ({ taskId: input.taskId, name, version }))
		return view
	}

	async submitFeedback(input: unknown, panelSession?: BoardSession): Promise<{ submittedCount: number; warning?: string }> {
		const request = feedbackRequestSchema.parse(input)
		const session = panelSession ?? this.findSession(request.taskId, request.name)
		if (!session?.displayed) throw new Error("Open and refresh the architecture board before sending feedback")
		const scope = [...new Set(request.versions)].map((version) => ({ taskId: request.taskId, name: request.name, version }))
		const generation = session.generation
		const check = () => {
			this.assertSession(request.taskId, session)
			const displayed = new Set(session.displayed?.map((identity) => `${identity.name}:${identity.version}`))
			if (
				session.generation !== generation ||
				displayed.size !== scope.length ||
				scope.some((identity) => !displayed.has(`${identity.name}:${identity.version}`))
			)
				throw new Error("Displayed feedback scope changed; refresh before sending")
		}
		check()
		if (!this.conversation) throw new Error("Feedback submission is unavailable on this host")
		return this.feedback.submit(scope, this.conversation.input(request.taskId), check)
	}

	async savePresentation(input: unknown, panelSession?: BoardSession): Promise<void> {
		const mutation = parsePresentationRequest(input)
		this.assertServed(mutation.identity, panelSession)
		await new ArchitectureStorage(mutation.identity.taskId, this.resolveTaskDirectory(mutation.identity.taskId)).mutateReview(
			mutation,
		)
	}

	async mutateComment(input: unknown, panelSession?: BoardSession): Promise<{ commentsJson: string }> {
		const mutation = parseCommentRequest(input)
		const session = this.assertServed(mutation.identity, panelSession)
		const review = await this.feedback.mutate(mutation.identity, () => {
			this.assertSession(mutation.identity.taskId, session)
			return new ArchitectureStorage(
				mutation.identity.taskId,
				this.resolveTaskDirectory(mutation.identity.taskId),
			).mutateReview(mutation)
		})
		return { commentsJson: JSON.stringify(review.comments) }
	}

	async openCode(input: unknown, panelSession?: BoardSession): Promise<void> {
		const request = codeRequestSchema.parse(input)
		const session = this.assertServed(request, panelSession)
		const viewer = getHostCapabilities().architectureViewer
		if (!viewer?.openCode || !session.workspace)
			throw new Error("Code navigation is unavailable: the host or owning workspace is unavailable")
		const directory = this.resolveTaskDirectory(request.taskId)
		await runArchitectureOperation(directory, async (assertCurrent) => {
			const { diagram } = await new ArchitectureStorage(request.taskId, directory).fetchDiagram(
				request.name,
				request.version,
			)
			const element = (request.targetKind === "node" ? diagram.nodes : diagram.edges).find(
				(item) => item.id === request.targetId,
			)
			const reference = element?.code?.[request.referenceIndex]
			if (!reference) throw new Error("Code reference does not exist in this saved version")
			const absolutePath = await resolveArchitectureCode(session.workspace!, reference)
			assertCurrent()
			this.assertSession(request.taskId, session)
			await viewer.openCode!(absolutePath, reference.line, reference.symbol, () => {
				assertCurrent()
				this.assertSession(request.taskId, session)
			})
		})
	}

	private assertServed(identity: ResolvedArchitectureIdentity, panelSession?: BoardSession): BoardSession {
		const session = panelSession ?? this.findSession(identity.taskId, identity.name)
		if (!session) throw new Error("Architecture board is closed")
		this.assertSession(identity.taskId, session)
		if (!session.served.has(`${identity.name}:${identity.version}`))
			throw new Error("This version has not been displayed in this panel")
		return session
	}

	/** The editor panel is not a second full-trust chat client. */
	private async receive(
		taskId: string,
		session: BoardSession,
		message: WebviewMessage,
		post: (response: ExtensionMessage) => Promise<boolean>,
	): Promise<void> {
		const request = message?.grpc_request
		if (!request || typeof request.request_id !== "string") return
		try {
			this.assertSession(taskId, session)
			if (
				message.type !== "grpc_request" ||
				request.is_streaming ||
				request.service !== "dirac.ArchitectureService" ||
				![
					"readArchitectureBoard",
					"saveArchitecturePresentation",
					"mutateArchitectureComment",
					"submitArchitectureFeedback",
					"openArchitectureCode",
				].includes(request.method) ||
				request.message?.taskId !== taskId
			) {
				throw new Error("This panel can only read or review its owning architecture board")
			}
			let result: unknown = {}
			switch (request.method) {
				case "readArchitectureBoard":
					result = await this.read(request.message, session)
					break
				case "saveArchitecturePresentation":
					await this.savePresentation(request.message, session)
					break
				case "mutateArchitectureComment":
					result = await this.mutateComment(request.message, session)
					break
				case "submitArchitectureFeedback":
					result = await this.submitFeedback(request.message, session)
					break
				case "openArchitectureCode":
					await this.openCode(request.message, session)
					break
			}
			await post({ type: "grpc_response", grpc_response: { request_id: request.request_id, message: result } })
		} catch (error) {
			await post({
				type: "grpc_response",
				grpc_response: { request_id: request.request_id, error: error instanceof Error ? error.message : String(error) },
			})
		}
	}

	/** Task-only callers must not silently choose among several open diagram panels. */
	private findSession(taskId: string, name?: string): BoardSession | undefined {
		if (name !== undefined) return this.sessions.get(sessionKey(taskId, name))
		const matches = [...this.sessions.values()].filter((session) => session.selection.taskId === taskId)
		if (matches.length > 1) throw new Error("Multiple architecture boards are open; specify a diagram selection")
		return matches[0]
	}

	private assertCurrentOwner(taskId: string): void {
		if (this.disposed) throw new Error("Architecture controller is disposed")
		this.assertOwner(taskId)
	}

	private assertSession(taskId: string, session: BoardSession): void {
		this.assertCurrentOwner(taskId)
		if (session.selection.taskId !== taskId || this.sessions.get(sessionKey(taskId, session.selection.name)) !== session)
			throw new Error("Architecture panel request is stale")
	}

	private remove(taskId: string, session: BoardSession): void {
		const key = sessionKey(taskId, session.selection.name)
		if (this.sessions.get(key) === session) this.sessions.delete(key)
		session.unsubscribe()
	}

	dispose(): void {
		this.disposed = true
		this.pendingOpens.clear()
		const failures: unknown[] = []
		for (const session of this.sessions.values()) {
			try {
				this.remove(session.selection.taskId, session)
			} catch (error) {
				failures.push(error)
			}
			try {
				session.panel?.dispose()
			} catch (error) {
				failures.push(error)
			}
		}
		if (failures.length) throw new AggregateError(failures, "Architecture board cleanup failed")
	}
}
