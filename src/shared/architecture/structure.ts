import type { ArchitectureDiagram } from "./diagram"

/** Presentation reuse depends on containment/identity, not labels, edges or proposal markers. */
export function architectureStructure(diagram: ArchitectureDiagram): string {
	return JSON.stringify(
		diagram.nodes
			.map(({ id, kind, parentId }) => [id, kind === "group", parentId ?? null])
			.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
	)
}
