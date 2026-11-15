import type { Controller } from ".."
import type { ArchitecturePresentationRequest } from "@shared/proto/dirac/architecture"
import { Empty } from "@shared/proto/dirac/common"

export async function saveArchitecturePresentation(
	controller: Controller,
	request: ArchitecturePresentationRequest,
): Promise<Empty> {
	await (await controller.getArchitectureBoards()).savePresentation(request)
	return Empty.create()
}
