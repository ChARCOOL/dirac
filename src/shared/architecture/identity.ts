/** A selection preserves intent: latest is resolved anew whenever it is opened. */
export type ArchitectureSelection =
	| { taskId: string; name: string; mode: "latest" }
	| { taskId: string; name: string; mode: "exact"; version: number }
	| { taskId: string; name: string; mode: "comparison"; startVersion: number; endVersion: number }

/** Saved content and every review mutation belong to one task and one exact version. */
export interface ResolvedArchitectureIdentity {
	taskId: string
	name: string
	version: number
}

export interface ArchitectureDiagramInventoryEntry {
	name: string
	versions: number[]
}
