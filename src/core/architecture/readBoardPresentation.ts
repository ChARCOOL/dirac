import type { ArchitectureDiagram, ArchitecturePresentation, ResolvedArchitectureIdentity } from "@shared/architecture"
import { architectureStructure } from "@shared/architecture/structure"
import type { ArchitectureStorage } from "./ArchitectureStorage"
import { runArchitectureOperation } from "./architectureOperations"

/** Optional review failure is explicit and never makes a valid semantic graph unreadable. */
export async function readBoardPresentation(
	storage: ArchitectureStorage,
	identity: ResolvedArchitectureIdentity,
	diagram: ArchitectureDiagram,
	taskDirectory: string,
): Promise<{ presentationJson?: string; reviewError?: string }> {
	try {
		return await runArchitectureOperation(taskDirectory, async (assertCurrent) => {
			let presentation: ArchitecturePresentation | undefined = (await storage.readReview(identity)).presentation
			const structure = architectureStructure(diagram)
			for (let version = identity.version - 1; !presentation && version > 0; version--) {
				assertCurrent()
				const previous = await storage.fetchDiagram(identity.name, version)
				if (architectureStructure(previous.diagram) !== structure) break
				presentation = (await storage.readReview({ ...identity, version })).presentation
			}
			assertCurrent()
			return { presentationJson: presentation ? JSON.stringify(presentation) : undefined }
		})
	} catch (error) {
		return { reviewError: `Saved presentation unavailable: ${error instanceof Error ? error.message : String(error)}` }
	}
}
