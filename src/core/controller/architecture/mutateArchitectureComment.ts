import type { Controller } from ".."
import type { ArchitectureCommentRequest, ArchitectureComments } from "@shared/proto/dirac/architecture"

export async function mutateArchitectureComment(
	controller: Controller,
	request: ArchitectureCommentRequest,
): Promise<ArchitectureComments> {
	return (await controller.getArchitectureBoards()).mutateComment(request)
}
