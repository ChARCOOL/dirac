import type { Controller } from ".."
import type { ArchitectureReference } from "@shared/proto/dirac/architecture"
import { Empty } from "@shared/proto/dirac/common"

export async function openArchitectureBoard(controller: Controller, request: ArchitectureReference): Promise<Empty> {
	await (await controller.getArchitectureBoards()).open(request)
	return Empty.create()
}
