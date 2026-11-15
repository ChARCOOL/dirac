/** Persisted conversation input, not raw chat: never run command or mention expansion. */
export interface ContextualInput {
	text: string
	/** Opaque source identities stored with the transcript, never included in model content. */
	references: string[]
}

export type ContextualInputRoute = { kind: "steering" } | { kind: "interaction"; cardId: string } | { kind: "followup" }

export interface ContextualInputAcceptance {
	/** The conversation write completed, independently of presentation/source synchronization. */
	persisted: true
	warning?: string
}
