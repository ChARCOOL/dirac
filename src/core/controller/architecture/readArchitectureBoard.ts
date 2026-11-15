import type { Controller } from ".."
import type { ArchitectureBoardRequest, ArchitectureBoardView } from "@shared/proto/dirac/architecture"

export async function readArchitectureBoard(
	controller: Controller,
	request: ArchitectureBoardRequest,
): Promise<ArchitectureBoardView> {
	return (await controller.getArchitectureBoards()).read(request)
}
