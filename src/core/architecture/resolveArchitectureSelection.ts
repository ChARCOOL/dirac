import type { ArchitectureSelection } from "@shared/architecture"
import type { ArchitectureBoardView } from "@shared/proto/dirac/architecture"
import type { ArchitectureStorage } from "./ArchitectureStorage"

export async function resolveArchitectureSelection(
	selection: ArchitectureSelection,
	storage: Pick<ArchitectureStorage, "fetchDiagram">,
): Promise<ArchitectureBoardView> {
	const versions =
		selection.mode === "comparison"
			? [selection.startVersion, selection.endVersion]
			: [selection.mode === "exact" ? selection.version : undefined]
	const diagrams = await Promise.all(versions.map((version) => storage.fetchDiagram(selection.name, version)))
	// Availability is advisory: a damaged/missing latest must not prevent reviewing
	// a valid exact snapshot or change either side of a fixed comparison.
	let latestVersion: number | undefined
	let latestVersionError: string | undefined
	if (selection.mode === "latest") latestVersion = diagrams[0].version
	else {
		try {
			latestVersion = (await storage.fetchDiagram(selection.name)).version
		} catch (error) {
			// Expose advisory failures without substituting or blocking requested snapshots.
			latestVersionError = error instanceof Error ? error.message : String(error)
		}
	}
	return {
		selection,
		latestVersion,
		latestVersionError,
		panes: diagrams.map(({ name, version, diagram }) => ({
			name,
			version,
			title: diagram.title,
			summary: diagram.summary,
			diagramJson: JSON.stringify(diagram),
		})),
	}
}
