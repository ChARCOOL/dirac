import type { ElkNode } from "elkjs/lib/elk-api"
import type { ArchitectureDiagram, ArchitecturePosition } from "@shared/architecture"
import { allocateLayoutSpace } from "./layoutSpace"
import {
	GROUP_MIN_SIZE,
	LAYOUT_LIMITS,
	PREFERRED_ASPECT_RATIO,
	type LayoutInput,
	type LayoutOptions,
	type LayoutOutput,
} from "./layoutTypes"

export { FIT_PADDING, GROUP_MIN_SIZE, LAYOUT_LIMITS, PREFERRED_ASPECT_RATIO } from "./layoutTypes"
export type { LayoutCandidateMetrics, LayoutInput, LayoutOptions, LayoutOutput } from "./layoutTypes"

/** ELK MULTI_EDGE cannot wrap a compound node that also owns relationship ports. */
export function wrappableGroupIds(diagram: ArchitectureDiagram): Set<string> {
	const endpoints = new Set(diagram.edges.flatMap((edge) => [edge.source, edge.target]))
	return new Set(diagram.nodes.filter((node) => node.kind === "group" && !endpoints.has(node.id)).map((node) => node.id))
}

export function toElkGraph(
	input: LayoutInput,
	{ wrapGroups = false, wrapRoot = true, compact = false, partitionGroups = false }: LayoutOptions = {},
): ElkNode {
	const { diagram, dimensions } = input
	if (diagram.nodes.length > LAYOUT_LIMITS.nodes || diagram.edges.length > LAYOUT_LIMITS.edges)
		throw new Error("Graph exceeds layout limits (500 nodes / 2,000 edges)")
	for (const node of diagram.nodes) {
		const size = dimensions[node.id]
		if (!size || ![size.width, size.height].every((n) => Number.isFinite(n) && n > 0 && n <= LAYOUT_LIMITS.dimension))
			throw new Error(`Node ${node.id} has no valid measured dimensions`)
	}
	const space = allocateLayoutSpace(input)
	const aspectRatio = space?.aspectRatio ?? PREFERRED_ASPECT_RATIO
	const spacing: Record<string, string> = space
		? {
			"elk.spacing.nodeNode": String(space.nodeGap),
			"elk.layered.spacing.nodeNodeBetweenLayers": String(space.layerGap),
		}
		: {}
	const nodes = new Map<string, ElkNode>()
	const callers = new Set(diagram.edges.filter((edge) => edge.kind === "api_call").map((edge) => edge.source))
	const incomingTargets = new Set(diagram.edges.map((edge) => edge.target))
	const wrappable = wrappableGroupIds(diagram)
	for (const node of [...diagram.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
		const size = dimensions[node.id]
		nodes.set(node.id, {
			id: `node:${node.id}`,
			// Expanded group bounds are a result, not an input: reusing them changes
			// wrapping on every Arrange/reopen. Leaf cards retain their measured size.
			...(node.kind === "group" ? GROUP_MIN_SIZE : size),
			...(node.kind === "group"
				? {
					children: [],
					layoutOptions: {
						...spacing,
						"elk.padding": space ? "[top=88,left=48,bottom=48,right=48]" : "[top=80,left=32,bottom=36,right=32]",
						"elk.layered.feedbackEdges": "true",
						"elk.layered.compaction.postCompaction.strategy": compact ? "EDGE_LENGTH" : "NONE",
						// Root options do not wrap flows inside compound subsystems.
						...(wrapGroups && wrappable.has(node.id)
							? {
								"elk.aspectRatio": String(
									(partitionGroups && space?.groupAspectRatios.get(node.id)) || aspectRatio,
								),
								"elk.layered.wrapping.strategy": "MULTI_EDGE",
							}
							: {}),
					},
				}
				: {
					// ELK's hard FIRST constraint requires no incoming relationships, regardless of kind.
					layoutOptions:
						callers.has(node.id) && !incomingTargets.has(node.id)
							? { "elk.layered.layering.layerConstraint": "FIRST" }
							: {},
				}),
		})
	}
	const root: ElkNode = {
		id: "__board_root__",
		children: [],
		edges: [],
		layoutOptions: {
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
			// A soft composition target: wrap long flows, never stretch cards or invent relationships.
			"elk.aspectRatio": String(aspectRatio),
			"elk.layered.wrapping.strategy": wrapRoot ? "MULTI_EDGE" : "OFF",
			"elk.hierarchyHandling": "INCLUDE_CHILDREN",
			"elk.edgeRouting": "ORTHOGONAL",
			"elk.layered.feedbackEdges": "true",
			"elk.layered.compaction.postCompaction.strategy": compact ? "EDGE_LENGTH" : "NONE",
			"elk.spacing.nodeNode": "44",
			"elk.spacing.edgeNode": "24",
			"elk.spacing.edgeEdge": "14",
			"elk.layered.spacing.nodeNodeBetweenLayers": "88",
			"elk.layered.spacing.edgeNodeBetweenLayers": "28",
			"elk.layered.spacing.edgeEdgeBetweenLayers": "16",
			...spacing,
			"elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
			"elk.layered.mergeEdges": "false",
			"elk.randomSeed": "1",
		},
	}
	for (const semantic of [...diagram.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
		const parent = semantic.parentId ? nodes.get(semantic.parentId)! : root
		parent.children!.push(nodes.get(semantic.id)!)
	}
	root.edges = [...diagram.edges]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((edge) => ({
			id: `edge:${edge.id}`,
			sources: [`node:${edge.source}`],
			targets: [`node:${edge.target}`],
			layoutOptions: {
				"elk.layered.priority.direction": ["api_call", "aggregation", "transition"].includes(edge.kind) ? "10" : "1",
			},
		}))
	return root
}

export function fromElkGraph(graph: ElkNode): LayoutOutput {
	const result: LayoutOutput = { positions: {}, sizes: {}, routes: {} }
	const origins = new Map<string, ArchitecturePosition>([[graph.id, { x: 0, y: 0 }]])
	const valid = (n: unknown): n is number =>
		typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= LAYOUT_LIMITS.dimension
	// Container offsets can make one horizontal ELK segment differ by ~1e-13 in y.
	// Canonicalize sub-pixel noise before exact orthogonal routing/validation, not real diagonals.
	const routeCoordinate = (n: number) => Math.round(n * 1_000_000) / 1_000_000
	const visit = (node: ElkNode, origin: ArchitecturePosition) => {
		for (const child of node.children ?? []) {
			const { x, y, width, height } = child
			if (![x, y, width, height].every(valid) || width! <= 0 || height! <= 0)
				throw new Error("Layout returned invalid or oversized coordinates")
			const id = child.id.slice("node:".length)
			result.positions[id] = { x: x!, y: y! }
			result.sizes[id] = { width: width!, height: height! }
			const absolute = { x: origin.x + x!, y: origin.y + y! }
			origins.set(child.id, absolute)
			visit(child, absolute)
		}
	}
	visit(graph, { x: 0, y: 0 })
	const routes = (node: ElkNode) => {
		for (const edge of node.edges ?? []) {
			// ELK identifies the containing coordinate space even when edges remain in the root collection.
			const origin = origins.get(edge.container ?? node.id)!
			if (!edge.sections?.length) continue
			const points = edge.sections.flatMap((section) => [
				section.startPoint,
				...(section.bendPoints ?? []),
				section.endPoint,
			])
			result.routes[edge.id.slice("edge:".length)] = points.map((point) => {
				const absolute = { x: origin.x + point.x, y: origin.y + point.y }
				if (!valid(absolute.x) || !valid(absolute.y)) throw new Error("Layout returned invalid route coordinates")
				return { x: routeCoordinate(absolute.x), y: routeCoordinate(absolute.y) }
			})
		}
		for (const child of node.children ?? []) routes(child)
	}
	routes(graph)
	return result
}
