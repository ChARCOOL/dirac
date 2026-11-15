import type { Controller } from ".."
import type { ArchitectureFeedbackRequest, ArchitectureFeedbackResult } from "@shared/proto/dirac/architecture"

export async function submitArchitectureFeedback(
	controller: Controller,
	request: ArchitectureFeedbackRequest,
): Promise<ArchitectureFeedbackResult> {
	return (await controller.getArchitectureBoards()).submitFeedback(request)
}
