import type { ElkNode } from "elkjs/lib/elk-api"
import {
    fromElkGraph,
    toElkGraph,
    wrappableGroupIds,
    type LayoutCandidateMetrics,
    type LayoutInput,
    type LayoutOptions,
    type LayoutOutput,
} from "./layoutGraph"
import { routeLayout } from "./routeLayout"
import { invalidPlacement, measureLayout } from "./layoutQuality"
import { absoluteBoxes } from "./routeGeometry"
import { resolveBoardStyle } from "./styles/catalog"
import { layoutAspectRatio, measureComposition } from "./layoutSpace"

export function layoutCandidates(input: LayoutInput): { id: string; options: LayoutOptions }[] {
	if (!input.diagram.edges.length) return [{ id: "unwrapped", options: { wrapRoot: false } }]
	const wraps: { id: string; options: LayoutOptions }[] = [
		{ id: "unwrapped", options: { wrapRoot: false, wrapGroups: false } },
		{ id: "root", options: { wrapRoot: true, wrapGroups: false } },
	]
	const wrappable = wrappableGroupIds(input.diagram)
	if (wrappable.size) {
		wraps.push(
			{ id: "groups", options: { wrapRoot: false, wrapGroups: true } },
			{ id: "both", options: { wrapRoot: true, wrapGroups: true } },
		)
	}
	// Give each subsystem a share of the pane instead of independently asking
	// every group to occupy the entire canvas's aspect ratio.
	if (input.canvas && input.diagram.nodes.filter((node) => !node.parentId && wrappable.has(node.id)).length > 1) {
		wraps.push({ id: "panels", options: { wrapRoot: true, wrapGroups: true, partitionGroups: true } })
	}
	return wraps.flatMap((candidate) => [
		candidate,
		{
			id: `${candidate.id}-compact`,
			options: { ...candidate.options, compact: true },
		},
	])
}

function dominates(a: LayoutCandidateMetrics, b: LayoutCandidateMetrics): boolean {
	return (
		a.extent <= b.extent &&
		a.routeLength <= b.routeLength &&
		a.bends <= b.bends &&
		(a.extent < b.extent || a.routeLength < b.routeLength || a.bends < b.bends)
	)
}

/** Prefer readable screen-space composition when a pane size is available.
 * Headless callers retain the Pareto-filtered extent² × wire policy. Geometry,
 * wiring, bends and stable IDs break ties; invalid candidates never participate. */
export function selectLayout(candidates: LayoutCandidateMetrics[]): LayoutCandidateMetrics {
	const valid = candidates.filter((candidate) => !candidate.invalid)
	if (!valid.length) throw new Error(`No valid layout: ${candidates.map((c) => `${c.id}: ${c.invalid}`).join("; ")}`)
	// Do not discard a spacious layout merely because a cramped one has shorter
	// wiring. Legacy/headless callers retain the geometric fit/wiring policy.
	const frontier = valid.some((candidate) => candidate.composition)
		? valid
		: valid.filter((candidate) => !valid.some((other) => dominates(other, candidate)))
	const cost = (candidate: LayoutCandidateMetrics) => candidate.extent ** 2 * candidate.routeLength
	return frontier.sort(
		(a, b) =>
			(a.composition?.cost ?? 0) - (b.composition?.cost ?? 0) ||
			cost(a) - cost(b) ||
			a.extent - b.extent ||
			a.routeLength - b.routeLength ||
			a.bends - b.bends ||
			a.id.localeCompare(b.id),
	)[0]
}

/** Runs entirely in the dedicated worker. Only the selected presentation and metrics cross back to React. */
export function arrangeCandidates(input: LayoutInput, layoutGraph: (graph: ElkNode) => ElkNode): LayoutOutput {
	const { geometry } = resolveBoardStyle(input.styleId)
	const layouts = new Map<string, LayoutOutput>()
	const metrics: LayoutCandidateMetrics[] = []
	for (const { id, options } of layoutCandidates(input)) {
		const graph = toElkGraph(input, options)
		let laidOut: ElkNode
		try {
			laidOut = layoutGraph(graph)
		} catch (error) {
			// ELK can reject one strategy (notably compound post-compaction) while
			// another succeeds. Retain the failure, but do not discard other candidates.
			// Input construction and our geometry/routing code stay outside this catch.
			metrics.push({
				id,
				invalid: `ELK layout failed: ${error instanceof Error ? error.message : String(error)}`,
				extent: 0,
				routeLength: 0,
				bends: 0,
				shortcuts: 0,
				checks: 0,
				exhausted: false,
			})
			continue
		}
		const raw = fromElkGraph(laidOut)
		const quality = measureLayout(input.diagram, raw, geometry, layoutAspectRatio(input))
		const missing = input.diagram.edges.find((edge) => !raw.routes[edge.id] || raw.routes[edge.id].length < 2)
		const invalid =
			invalidPlacement(absoluteBoxes(input.diagram, raw)) ?? (missing ? `Missing route: ${missing.id}` : undefined)
		if (invalid) {
			metrics.push({ id, ...quality, invalid, shortcuts: 0, checks: 0, exhausted: false })
			continue
		}
		const cleaned = routeLayout(input.diagram, raw, false, geometry)
		layouts.set(id, cleaned.layout)
		const qualityAfterRouting = measureLayout(input.diagram, cleaned.layout, geometry, layoutAspectRatio(input))
		metrics.push({
			id,
			...cleaned.metrics,
			...qualityAfterRouting,
			composition: input.canvas ? measureComposition(input.diagram, cleaned.layout, input.canvas) : undefined,
			invalid: qualityAfterRouting.invalid ?? (cleaned.metrics.unbridged ? "Insufficient space for line jumps" : undefined),
		})
	}
	const selected = selectLayout(metrics)
	return { ...layouts.get(selected.id)!, diagnostics: { selected: selected.id, candidates: metrics } }
}
