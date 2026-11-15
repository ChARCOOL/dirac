import type { ArchitectureDiagram, ArchitectureSelection } from "@shared/architecture";

type WithoutTask<T> = T extends ArchitectureSelection ? Omit<T, "taskId"> : never
export type ArchitectureDisplaySelection = WithoutTask<ArchitectureSelection>
export type ArchitectureDisplayAvailability =
	| { available: true; selection: ArchitectureSelection; waitForInput: boolean }
	| { available: false; reason: string }

/** Task-local planning output on viewer-capable hosts, independent of workspace-edit permissions. */
export interface IArchitectureTrait {
	openDisplay?(selection: ArchitectureDisplaySelection): Promise<ArchitectureDisplayAvailability>
	upsertDiagram(name: string, diagram: string): Promise<{ name: string; version: number }>
	listDiagrams(): Promise<Array<{ name: string; versions: number[] }>>
	fetchDiagram(name: string, version?: number): Promise<{ name: string; version: number; diagram: ArchitectureDiagram }>
}
