import type { ArchitectureDiagram, ArchitecturePosition } from "@shared/architecture"
import type { RouteJumps } from "./lineJumpTypes"

export const LAYOUT_LIMITS = { nodes: 500, edges: 2000, timeoutMs: 10_000, dimension: 1_000_000 } as const
export const GROUP_MIN_SIZE = { width: 340, height: 220 } as const
export const PREFERRED_ASPECT_RATIO = 16 / 9
export const FIT_PADDING = 0.08

export interface LayoutInput {
	diagram: ArchitectureDiagram
	dimensions: Record<string, { width: number; height: number }>
	styleId?: string
	/** Actual pane size, sampled only for initial layout and explicit Arrange. */
	canvas?: { width: number; height: number }
	fixedLayout?: LayoutOutput
}
export interface LayoutOutput {
	positions: Record<string, ArchitecturePosition>
	sizes: Record<string, { width: number; height: number }>
	routes: Record<string, ArchitecturePosition[]>
	decorations?: Record<string, RouteJumps>
	diagnostics?: { selected: string; candidates: LayoutCandidateMetrics[] }
}
export interface LayoutCandidateMetrics {
	id: string
	extent: number
	routeLength: number
	bends: number
	shortcuts: number
	checks: number
	exhausted: boolean
	retained?: string[]
	restored?: string[]
	portChecks?: number
	reattached?: string[]
	unbridged?: number
	invalid?: string
	composition?: { zoom: number; crowding: number; unused: number; cost: number }
}
export interface LayoutOptions {
	wrapGroups?: boolean
	wrapRoot?: boolean
	compact?: boolean
	partitionGroups?: boolean
}
