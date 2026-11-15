import { DiracMessageType, type DiracMessage, type TaskStatus } from "@shared/ExtensionMessage"
import type { ContextualInput, ContextualInputAcceptance, ContextualInputRoute } from "@shared/messages/contextualInput"

interface ForegroundConversation {
	taskId: string
	executionProfile: string
	stateView: {
		abort: boolean
		status: TaskStatus
		waitingCardIds: readonly string[]
		lastWaitingCardId?: string
		waitingForFollowUp: boolean
	}
	messageStateHandler: { getDiracMessages(): DiracMessage[] }
	canAcceptSteeringMessage(): boolean
	submitContextualInput(
		input: ContextualInput,
		route: ContextualInputRoute,
		assertOwner: () => void,
	): Promise<ContextualInputAcceptance>
}

export interface ArchitectureFeedbackInput {
	submit(input: ContextualInput, assertCurrent: () => void): Promise<ContextualInputAcceptance>
}

/** Resolve the owning selected foreground runtime, never the generic selected-task RPC endpoints. */
export function architectureFeedbackInput(
	taskId: string,
	selected: () => { task?: ForegroundConversation; goalId?: string },
): ArchitectureFeedbackInput {
	const task = selected().task
	const assertOwner = () => {
		const current = selected()
		if (!task || current.task !== task || task.taskId !== taskId || (current.goalId && current.goalId !== taskId))
			throw new Error("Resume the owning conversation before sending architecture feedback")
		if (!["standalone", "goal_coordinator", "goal_followup"].includes(task.executionProfile) || task.stateView.abort)
			throw new Error("Architecture feedback requires a live foreground conversation")
	}
	assertOwner()
	const state = task!.stateView
	let route: ContextualInputRoute
	if (state.waitingCardIds.length) {
		const message = task!.messageStateHandler
			.getDiracMessages()
			.find(
				(message) =>
					message.content.type === DiracMessageType.CARD && message.content.card.id === state.lastWaitingCardId,
			)
		const card = message?.content.type === DiracMessageType.CARD ? message.content.card : undefined
		if (
			!card?.architectureReference ||
			card.architectureReference.taskId !== taskId ||
			!card.requireFeedback ||
			card.requireApproval ||
			state.waitingCardIds.length !== 1
		)
			throw new Error("Answer the unrelated permission or question first; architecture comments remain pending")
		route = { kind: "interaction", cardId: card.id }
	} else if (state.waitingForFollowUp) {
		route = { kind: "followup" }
	} else {
		if (!task!.canAcceptSteeringMessage())
			throw new Error("Conversation cannot accept feedback now; resume it through the existing flow")
		route = { kind: "steering" }
	}
	return {
		submit: (input, assertCurrent) =>
			task!.submitContextualInput(input, route, () => {
				assertCurrent()
				assertOwner()
			}),
	}
}
