import type { Controller } from ".."
import type { ArchitectureCodeRequest } from "@shared/proto/dirac/architecture"
import { Empty } from "@shared/proto/dirac/common"

export async function openArchitectureCode(controller: Controller, request: ArchitectureCodeRequest): Promise<Empty> {
	await (await controller.getArchitectureBoards()).openCode(request)
	return Empty.create()
}
