/** Semantic content only: these contracts have no renderer or filesystem dependencies. */
export type NodeKind = "component" | "class" | "function" | "database" | "service" | "api_endpoint" | "group" | "state" | "actor"
/** Transitions connect states; messages convey communication, not necessarily synchronous invocation. */
export type EdgeKind = "dependency" | "aggregation" | "data_flow" | "api_call" | "transition" | "message"
export type ProposalChange = "added" | "modified" | "removed"

export interface CodeReference {
	/** Workspace-relative POSIX path, optionally qualified as @workspace:path. Never a URI or command. */
	path: string
	symbol?: string
	/** One-based source line. Navigation still enforces the owning task's workspace/access rules. */
	line?: number
}

export interface ArchitectureNode {
	id: string
	/** Most specific truthful entity kind, resolved during authoring; component is not a default for code symbols. */
	kind: NodeKind
	label: string
	description?: string
	rationale?: string
	parentId?: string
	code?: CodeReference[]
	change?: ProposalChange
}

export interface ArchitectureEdge {
	id: string
	kind: EdgeKind
	source: string
	target: string
	label?: string
	description?: string
	rationale?: string
	code?: CodeReference[]
	change?: ProposalChange
}

export interface ArchitectureDiagram {
	title: string
	summary: string
	nodes: ArchitectureNode[]
	edges: ArchitectureEdge[]
}
