import { DiracMessage, DiracMessageType, SteeringTranscriptStatus } from "@shared/ExtensionMessage"
import type { DiracStorageMessage } from "@shared/messages/content"

export enum SteeringDeliveryState {
	QUEUED = "queued",
	CLAIMED = "claimed",
	SENT = "sent",
}

export interface SteeringMessage {
	id: string
	text: string
	createdAt: number
	transcriptMessageId: string
	deliveryState: SteeringDeliveryState
	claimId?: string
	/** Contextual feedback bypasses raw-chat command and mention parsing. */
	contextual?: boolean
}

export interface SteeringClaim {
	id: string
	messages: SteeringMessage[]
}

export function collectDeliveredSteeringMessageIds(history: readonly DiracStorageMessage[]): Set<string> {
	const deliveredIds = new Set<string>()
	for (const message of history) {
		if (typeof message.content === "string") continue
		for (const block of message.content) {
			if (block.type !== "text") continue
			const messageIds = "steeringMessageIds" in block ? block.steeringMessageIds : undefined
			for (const messageId of messageIds ?? []) deliveredIds.add(messageId)
		}
	}
	return deliveredIds
}

export function restoreQueuedSteeringMessages(
	messages: readonly DiracMessage[],
	deliveredMessageIds: ReadonlySet<string> = new Set(),
): SteeringMessage[] {
	return messages.flatMap((message) => {
		if (message.content.type !== DiracMessageType.MARKDOWN) return []
		if (message.content.steering?.status !== SteeringTranscriptStatus.QUEUED) return []
		if (deliveredMessageIds.has(message.id)) return []

		return [
			{
				id: message.id,
				text: message.content.content,
				createdAt: message.ts,
				transcriptMessageId: message.id,
				deliveryState: SteeringDeliveryState.QUEUED,
				...(message.content.contextualInput ? { contextual: true } : {}),
			},
		]
	})
}
function escapeXml(value: string): string {
	const entities: Record<string, string> = {
		"&": "&" + "amp;",
		"<": "&" + "lt;",
		">": "&" + "gt;",
		'"': "&" + "quot;",
		"'": "&" + "apos;",
	}
	return value.replace(/[&<>"']/g, (character) => entities[character])
}

export function formatSteeringMessages(messages: readonly Pick<SteeringMessage, "text">[]): string {
	const formattedMessages = messages.map((message) => `  <steering_message>${escapeXml(message.text)}</steering_message>`)
	return [
		"<steering_messages>",
		"The following messages were queued by the user while you were working.",
		"They are task-level steering for subsequent work. They are not necessarily related to the immediately preceding tool calls or tool results. Do not treat them as feedback on an adjacent tool result unless a message explicitly says so.",
		...formattedMessages,
		"</steering_messages>",
	].join("\n")
}
