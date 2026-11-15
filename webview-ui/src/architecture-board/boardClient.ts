import {
	ArchitectureReference,
	ArchitectureBoardRequest,
	ArchitectureBoardView,
	ArchitecturePresentationRequest,
	ArchitectureCodeRequest,
	ArchitectureCommentRequest,
	ArchitectureComments,
	ArchitectureFeedbackRequest,
	ArchitectureFeedbackResult,
} from "@shared/proto/dirac/architecture"
import { Empty } from "@shared/proto/dirac/common"
import type {
	ArchitecturePresentation,
	ResolvedArchitectureIdentity,
	ArchitectureSelection,
	CommentMutation,
	ReviewComment,
} from "@shared/architecture"
import { ProtoBusClient } from "@/shared/api/grpc-client-base"
import { PLATFORM_CONFIG } from "@/config/platform.config"
import type { ArchitecturePanelViewRequest, ArchitecturePanelStyleRequest } from "@shared/architecture/panel"

// Import only the board protocol, not the generated aggregate client/chat application.
export class BoardClient extends ProtoBusClient {
	static override serviceName = "dirac.ArchitectureService"
	static open(selection: ArchitectureSelection): Promise<Empty> {
		return this.makeUnaryRequest("openArchitectureBoard", selection, ArchitectureReference.toJSON, Empty.fromJSON, 15_000)
	}
	/** Host-local window action, deliberately separate from diagram/comment RPC. */
	static requestView(action: ArchitecturePanelViewRequest["action"]): void {
		PLATFORM_CONFIG.postMessage({ type: "architecture_board_view", action } satisfies ArchitecturePanelViewRequest)
	}
	static requestStyle(style: string): void {
		PLATFORM_CONFIG.postMessage({ type: "architecture_board_style", style } satisfies ArchitecturePanelStyleRequest)
	}
	static save(identity: ResolvedArchitectureIdentity, presentation: ArchitecturePresentation): Promise<Empty> {
		return this.makeUnaryRequest(
			"saveArchitecturePresentation",
			{ ...identity, presentationJson: JSON.stringify(presentation) },
			ArchitecturePresentationRequest.toJSON,
			Empty.fromJSON,
			10_000,
		)
	}
	static async mutateComment(mutation: CommentMutation): Promise<ReviewComment[]> {
		const { identity, ...change } = mutation
		const result = await this.makeUnaryRequest(
			"mutateArchitectureComment",
			{ ...identity, mutationJson: JSON.stringify(change) },
			ArchitectureCommentRequest.toJSON,
			ArchitectureComments.fromJSON,
			10_000,
		)
		return JSON.parse(result.commentsJson) as ReviewComment[]
	}
	static submitFeedback(scope: ResolvedArchitectureIdentity[]): Promise<ArchitectureFeedbackResult> {
		return this.makeUnaryRequest(
			"submitArchitectureFeedback",
			{ taskId: scope[0].taskId, name: scope[0].name, versions: scope.map((identity) => identity.version) },
			ArchitectureFeedbackRequest.toJSON,
			ArchitectureFeedbackResult.fromJSON,
			15_000,
		)
	}
	static openCode(request: ArchitectureCodeRequest): Promise<Empty> {
		return this.makeUnaryRequest("openArchitectureCode", request, ArchitectureCodeRequest.toJSON, Empty.fromJSON, 10_000)
	}
	static read(taskId: string, viewLatest = false, selection?: ArchitectureSelection): Promise<ArchitectureBoardView> {
		return this.makeUnaryRequest(
			"readArchitectureBoard",
			{ taskId, viewLatest, selection },
			ArchitectureBoardRequest.toJSON,
			ArchitectureBoardView.fromJSON,
			10_000,
		)
	}
}
