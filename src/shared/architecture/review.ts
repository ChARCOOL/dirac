import type { ResolvedArchitectureIdentity } from "./identity"

export type ReviewTarget = { kind: "diagram" } | { kind: "node"; id: string } | { kind: "edge"; id: string }

/** The sidecar's file identity supplies task, diagram name and version. */
export interface ReviewComment {
	id: string
	target: ReviewTarget
	text: string
	/** Included in persisted conversation input; not accepted, approved or resolved. */
	sent: boolean
}

export interface ArchitecturePosition {
	x: number
	y: number
}

export interface ArchitectureViewport {
	x: number
	y: number
	zoom: number
}

/** Plain saved coordinates, not renderer runtime objects or persisted edge routes. */
export interface ArchitecturePresentation {
	positions: Record<string, ArchitecturePosition>
	viewport?: ArchitectureViewport
}

export interface ReviewState {
	comments: ReviewComment[]
	presentation?: ArchitecturePresentation
}

/** Specific changes, never replacement of a stale complete sidecar. */
export type ReviewMutation = { identity: ResolvedArchitectureIdentity } & (
	| { operation: "add_comment"; comment: Omit<ReviewComment, "sent"> }
	| { operation: "edit_comment"; commentId: string; text: string }
	| { operation: "delete_comment"; commentId: string }
	| { operation: "save_presentation"; presentation: ArchitecturePresentation }
	/** Internal persistence acknowledgement only; a panel must not authorize this operation. */
	| { operation: "mark_sent"; commentIds: string[] }
)

export type CommentMutation = Exclude<ReviewMutation, { operation: "save_presentation" | "mark_sent" }>

export interface PendingArchitectureReview {
	version: number
	count: number
}

/** Conversation delivery bookkeeping, separate from semantic graphs and model-facing feedback. */
export interface ArchitectureFeedbackCommentIdentity extends ResolvedArchitectureIdentity {
	commentId: string
}
