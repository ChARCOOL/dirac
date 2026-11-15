import { getHostCapabilities, meetsHostCapabilityRequirement } from "@hosts/host-capabilities"
import type { IArchitectureTrait } from "../../interfaces/IArchitectureTrait"

interface ArchitectureTraitOptions {
	taskId: string
	foreground: boolean
	canWaitForInput: boolean
	resolveTaskDirectory(): string
}

/** Construction is side-effect free: ordinary tools never load or read board storage. */
export function buildArchitectureTrait(options: ArchitectureTraitOptions): IArchitectureTrait | undefined {
	if (!options.foreground || !meetsHostCapabilityRequirement({ requiredHostCapability: "architectureViewer" })) return undefined
	const storage = async () => {
		if (!meetsHostCapabilityRequirement({ requiredHostCapability: "architectureViewer" })) {
			throw new Error("Architecture viewer is unavailable on this host. Continue in chat.")
		}
		const { ArchitectureStorage } = await import("@core/architecture/ArchitectureStorage")
		return new ArchitectureStorage(options.taskId, options.resolveTaskDirectory())
	}
	return {
		upsertDiagram: async (name, diagram) => {
			const { notifyArchitecturePublication } = await import("@core/architecture/architecturePublications")
			const result = await (await storage()).upsertDiagram(name, diagram)
			notifyArchitecturePublication({ taskId: options.taskId, ...result })
			return result
		},
		listDiagrams: async () => (await storage()).listDiagrams(),
		fetchDiagram: async (name, version) => (await storage()).fetchDiagram(name, version),
		openDisplay: async (input) => {
			const viewer = getHostCapabilities().architectureViewer
			if (!viewer?.openSelection)
				return {
					available: false,
					reason: "Architecture viewer is unavailable on this host. Continue in chat.",
				}
			const { parseArchitectureSelection } = await import("@shared/architecture/selection")
			const selection = parseArchitectureSelection({ ...input, taskId: options.taskId })
			await viewer.openSelection(selection)
			// Autonomous execution disables the feedback wait, not opening the board.
			return { available: true, selection, waitForInput: options.canWaitForInput }
		},
	}
}
