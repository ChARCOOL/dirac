import type { ArchitectureDiagram, ArchitecturePresentation, ArchitectureNode, ArchitectureEdge } from "@shared/architecture"
import { Position, type Node, type Edge, type XYPosition } from "@xyflow/react"
import { GROUP_MIN_SIZE, type LayoutOutput } from "./layoutGraph"
import type { RouteJumps } from "./lineJumpTypes"
import { normalizeRoute } from "./routeGeometry"
import { groupPortSide, terminalSide } from "./nodeShapes"
import { boardNodeSizes } from "./styles/boardGeometry"
import type { ShapeSize } from "./styles/types"

type CommentCounts = { pending: number; sent: number }
export type BoardPort = { id: string; type: "source" | "target"; side: Position; offset: number; stub?: number }
export type BoardNode = Node<
	{
		semantic: ArchitectureNode
		ports: BoardPort[]
		comments?: CommentCounts
		dimmed?: boolean
	},
	"architecture"
>
export type BoardEdge = Edge<
	{
		semantic: ArchitectureEdge
		comments?: CommentCounts
		route?: XYPosition[]
		decorations?: RouteJumps
		lane: number
		showLabel?: boolean
		emphasized?: boolean
		dimmed?: boolean
	},
	"architecture"
>
export const STRUCTURE_LOCK = {
	nodesConnectable: false,
	edgesReconnectable: false,
	deleteKeyCode: null,
	connectOnClick: false,
} as const
export const GROUP_PADDING = 32
export const GROUP_HEADER = 72
export const NODE_WIDTH = 248

export function toFlowGraph(
	diagram: ArchitectureDiagram,
	presentation?: ArchitecturePresentation,
	dimensions: Record<string, ShapeSize> = {},
): { nodes: BoardNode[]; edges: BoardEdge[] } {
	const nodes: BoardNode[] = []
	const children = new Map<string | undefined, ArchitectureNode[]>()
	for (const node of diagram.nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
	const orderedEdges = [...diagram.edges].sort((a, b) => a.id.localeCompare(b.id))
	const visit = (parentId?: string) => {
		for (const [index, semantic] of (children.get(parentId) ?? []).sort((a, b) => a.id.localeCompare(b.id)).entries()) {
			const ports: BoardPort[] = []
			for (const type of ["source", "target"] as const) {
				const incident = orderedEdges.filter((edge) => edge[type] === semantic.id)
				incident.forEach((edge, index) =>
					ports.push({
						id: `${type}:${edge.id}`,
						type,
						side: type === "source" ? Position.Right : Position.Left,
						offset: ((index + 1) / (incident.length + 1)) * 100,
					}),
				)
			}
			nodes.push({
				id: semantic.id,
				type: "architecture",
				data: { semantic, ports },
				parentId,
				position: presentation?.positions[semantic.id] ?? {
					x: GROUP_PADDING + (index % 3) * 300,
					y: GROUP_HEADER + Math.floor(index / 3) * 160,
				},
				deletable: false,
				connectable: false,
				...(parentId ? { extent: "parent" as const } : {}),
				...(semantic.kind === "group" ? { dragHandle: ".node-group-drag-handle" } : {}),
				style:
					semantic.kind === "group"
						? { ...GROUP_MIN_SIZE, pointerEvents: "none" }
						: { ...(dimensions[semantic.id] ?? boardNodeSizes[semantic.kind]) },
				ariaLabel: `${semantic.kind}: ${semantic.label}${semantic.change ? `, proposed ${semantic.change}` : ""}`,
			})
			visit(semantic.id)
		}
	}
	visit()
	return {
		nodes: sizeGroups(nodes),
		edges: orderedEdges.map((semantic, index) => ({
			id: semantic.id,
			source: semantic.source,
			target: semantic.target,
			type: "architecture",
			sourceHandle: `source:${semantic.id}`,
			targetHandle: `target:${semantic.id}`,
			data: { semantic, lane: index % 5 },
			deletable: false,
			reconnectable: false,
			selectable: true,
			focusable: true,
			interactionWidth: 28,
			ariaLabel: `${semantic.kind}: ${semantic.source} to ${semantic.target}${semantic.label ? `, ${semantic.label}` : ""}`,
		})),
	}
}

/** Derive group bounds from current children; only positions are persisted, never renderer objects. */
export function sizeGroups(nodes: BoardNode[]): BoardNode[] {
	const sized = new Map<string, BoardNode>()
	for (const node of [...nodes].reverse()) {
		if (node.data.semantic.kind !== "group") {
			sized.set(node.id, node)
			continue
		}
		const children = nodes.filter((child) => child.parentId === node.id).map((child) => sized.get(child.id)!)
		const width = Math.max(
			GROUP_MIN_SIZE.width,
			...children.map(
				(child) => child.position.x + Number(child.style?.width ?? child.measured?.width ?? NODE_WIDTH) + GROUP_PADDING,
			),
		)
		const height = Math.max(
			GROUP_MIN_SIZE.height,
			...children.map(
				(child) => child.position.y + Number(child.style?.height ?? child.measured?.height ?? 112) + GROUP_PADDING,
			),
		)
		sized.set(node.id, { ...node, style: { ...node.style, width, height } })
	}
	return nodes.map((node) => sized.get(node.id)!)
}

/** Reuse a frame only when its entire local subtree still matches the canonical arrangement. */
export function restoreUnchangedGroupSizes(nodes: BoardNode[], layout: LayoutOutput): BoardNode[] {
	const unchanged = new Set<string>()
	const children = new Map<string, BoardNode[]>()
	for (const node of nodes) {
		if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
	}
	for (const node of [...nodes].reverse()) {
		if (node.data.semantic.kind !== "group") {
			const size = layout.sizes[node.id]
			if (Math.abs(node.measured!.width! - size.width) < 0.5 && Math.abs(node.measured!.height! - size.height) < 0.5)
				unchanged.add(node.id)
			continue
		}
		if (
			(children.get(node.id) ?? []).every(
				(child) =>
					unchanged.has(child.id) &&
					Math.abs(child.position.x - layout.positions[child.id].x) < 0.5 &&
					Math.abs(child.position.y - layout.positions[child.id].y) < 0.5,
			)
		)
			unchanged.add(node.id)
	}
	return nodes.map((node) =>
		node.data.semantic.kind === "group" && unchanged.has(node.id)
			? { ...node, style: { ...node.style, ...layout.sizes[node.id] } }
			: node,
	)
}

/** Anchor handles to ELK's actual boundary crossings, including back edges and group endpoints. */
export function applyLayoutPorts(nodes: BoardNode[], layout: LayoutOutput): BoardNode[] {
	const absolute = new Map<string, XYPosition>()
	for (const node of nodes) {
		const parent = node.parentId ? absolute.get(node.parentId)! : { x: 0, y: 0 }
		absolute.set(node.id, { x: parent.x + layout.positions[node.id].x, y: parent.y + layout.positions[node.id].y })
	}
	return nodes.map((node) => {
		const origin = absolute.get(node.id)!
		const size = layout.sizes[node.id]
		const ports = node.data.ports.map((port) => {
			const route = layout.routes[port.id.slice(port.type.length + 1)]
			if (!route) return port
			const point = port.type === "source" ? route[0] : route[route.length - 1]
			const adjacent = port.type === "source" ? route[1] : route[route.length - 2]
			const x = point.x - origin.x
			const y = point.y - origin.y
			const side = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom }[
				node.data.semantic.kind === "group"
					? groupPortSide(point, adjacent, { ...origin, ...size })
					: terminalSide(point, adjacent)
			]
			return {
				...port,
				side,
				stub: Math.min(12, Math.abs(point.x - adjacent.x) + Math.abs(point.y - adjacent.y)),
				offset: side === Position.Top || side === Position.Bottom ? (x / size.width) * 100 : (y / size.height) * 100,
			}
		})
		return { ...node, data: { ...node.data, ports } }
	})
}

/** Snapshot live geometry for worker-only rerouting; never changes nodes or viewport. */
export function fixedLayoutFromNodes(nodes: BoardNode[], edges: BoardEdge[]): LayoutOutput {
	const layout: LayoutOutput = {
		positions: Object.fromEntries(nodes.map((node) => [node.id, node.position])),
		sizes: Object.fromEntries(
			nodes.map((node) => [
				node.id,
				{
					width: Number(node.style?.width ?? node.measured!.width!),
					height: Number(node.style?.height ?? node.measured!.height!),
				},
			]),
		),
		routes: {},
	}
	const absolute = new Map<string, XYPosition>()
	for (const node of nodes) {
		const parent = node.parentId ? absolute.get(node.parentId)! : { x: 0, y: 0 }
		absolute.set(node.id, { x: parent.x + node.position.x, y: parent.y + node.position.y })
	}
	const terminal = (nodeId: string, handle: string): [XYPosition, XYPosition] => {
		const node = nodes.find((node) => node.id === nodeId)!
		const port = node.data.ports.find((port) => port.id === handle)!
		const origin = absolute.get(nodeId)!
		const size = layout.sizes[nodeId]
		const vertical = port.side === Position.Top || port.side === Position.Bottom
		const point = {
			x: origin.x + (vertical ? (size.width * port.offset) / 100 : port.side === Position.Left ? 0 : size.width),
			y: origin.y + (!vertical ? (size.height * port.offset) / 100 : port.side === Position.Top ? 0 : size.height),
		}
		return [
			point,
			{
				x:
					point.x +
					(port.side === Position.Left ? -(port.stub ?? 12) : port.side === Position.Right ? (port.stub ?? 12) : 0),
				y:
					point.y +
					(port.side === Position.Top ? -(port.stub ?? 12) : port.side === Position.Bottom ? (port.stub ?? 12) : 0),
			},
		]
	}
	for (const edge of edges) {
		const [a, start] = terminal(edge.source, edge.sourceHandle!)
		const [b, end] = terminal(edge.target, edge.targetHandle!)
		layout.routes[edge.id] = normalizeRoute([a, start, { x: start.x, y: end.y }, end, b])
	}
	return layout
}
