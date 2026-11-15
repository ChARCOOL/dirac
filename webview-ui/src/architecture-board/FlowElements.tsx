import { useEffect, useId } from "react"
import { NodeTitle } from "./NodeTitle"
import { NodeSilhouette } from "./NodeSilhouette"
import { NODE_KIND_LABELS, shapePort } from "./nodeShapes"
import {
	Handle,
	Position,
	BaseEdge,
	EdgeLabelRenderer,
	getSmoothStepPath,
	useUpdateNodeInternals,
	useStore,
	type NodeProps,
	type EdgeProps,
} from "@xyflow/react"
import type { BoardNode, BoardEdge } from "./flowGraph"
import { CommentBadges } from "./CommentBadges"
import { roundedRoute } from "./edgeGeometry"
import { useBoardStyle, StyleNodeAppearance, StyleNodeContent } from "./styles/StyleContext"
import { nodeTextRegions } from "./textLayout"

export function ArchitectureNodeView({ id, data, selected, width = 248, height = 102 }: NodeProps<BoardNode>) {
	const node = data.semantic
	const { badge } = nodeTextRegions(node.kind, { width, height }, !!node.change)
	const style = useBoardStyle()
	const updateNodeInternals = useUpdateNodeInternals()
	useEffect(() => updateNodeInternals(id), [id, data.ports, width, height, style, updateNodeInternals])
	return (
		<div
			className={`board-node kind-${node.kind}${selected ? " is-selected" : ""}${data.dimmed ? " is-dimmed" : ""}`}
			data-nested={!!node.parentId}
			title={`${NODE_KIND_LABELS[node.kind]}: ${node.label}`}>
			<NodeSilhouette kind={node.kind} width={width} height={height} />
			{node.kind === "group" && <div className="node-group-drag-handle" aria-hidden="true" />}
			<StyleNodeAppearance kind={node.kind} width={width} height={height} />
			<StyleNodeContent
				kind={node.kind}
				label={node.label}
				width={width}
				height={height}
				title={
					<NodeTitle
						label={node.label}
						kind={node.kind}
						width={width}
						height={height}
						proposal={!!node.change}
						headerInset={data.comments?.pending || data.comments?.sent ? 190 : 0}
					/>
				}
			/>
			{node.change && (
				<span
					className={`proposal change-${node.change}`}
					style={
						badge
							? {
									left: badge.x,
									top: badge.y,
									bottom: "auto",
									width: badge.width,
									maxWidth: badge.width,
									height: badge.height,
									transform: "none",
									textAlign: "center",
								}
							: undefined
					}>
					Proposed: {node.change}
				</span>
			)}
			<CommentBadges counts={data.comments} />
			{data.ports.map((port) => {
				const horizontal = port.side === Position.Top || port.side === Position.Bottom
				const point = shapePort(
					node.kind,
					{ width, height },
					port.side,
					((horizontal ? width : height) * port.offset) / 100,
					style.geometry,
				)
				return (
					<Handle
						key={port.id}
						id={port.id}
						type={port.type}
						position={port.side}
						isConnectable={false}
						style={{
							left: `${(point.x / width) * 100}%`,
							top: `${(point.y / height) * 100}%`,
							right: "auto",
							bottom: "auto",
							transform: "translate(-50%, -50%)",
						}}
					/>
				)
			})}
		</div>
	)
}

export function ArchitectureEdgeView(props: EdgeProps<BoardEdge>) {
	const { data, selected, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props
	const zoom = useStore((state) => state.transform[2])
	const style = useBoardStyle()
	const markerId = `board-arrow-${useId().replaceAll(":", "")}`
	const edge = data!.semantic
	const self = props.source === props.target
	const [fallbackPath, fallbackX, fallbackY] = getSmoothStepPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		borderRadius: 10,
		offset: 28 + data!.lane * 12,
	})
	const route = data?.route
		? roundedRoute(data.route, data.decorations, zoom)
		: self
			? {
					path: `M ${sourceX} ${sourceY} C ${sourceX + 100} ${sourceY - 130}, ${targetX - 100} ${targetY - 130}, ${targetX} ${targetY}`,
					label: { x: (sourceX + targetX) / 2, y: Math.min(sourceY, targetY) - 90 },
				}
			: { path: fallbackPath, label: { x: fallbackX, y: fallbackY } }
	const visible = selected || data?.showLabel
	const stroke = `var(--board-edge-${edge.kind})`
	const emphasized = selected || data?.emphasized
	const strokeWidth = style.edgeWidth + (selected ? 1.1 : emphasized ? 0.4 : 0)
	const opacity = data?.dimmed ? 0.13 : emphasized ? 1 : "var(--board-edge-idle-opacity)"
	const arrowWidth = selected ? 10 : 8
	const start = data?.route?.[0] ?? { x: sourceX, y: sourceY }
	const next = data?.route?.[1]
	const terminalRoute = data?.route && data.decorations?.gaps.length ? data.route.slice(-2) : undefined
	const angle = next
		? (Math.atan2(next.y - start.y, next.x - start.x) * 180) / Math.PI
		: sourcePosition === Position.Left
			? 180
			: sourcePosition === Position.Top
				? -90
				: sourcePosition === Position.Bottom
					? 90
					: 0
	return (
		<>
			{edge.kind !== "aggregation" && (
				<defs>
					<marker
						id={markerId}
						viewBox="0 0 12 10"
						refX={edge.kind === "transition" ? 11 : 12}
						refY={5}
						markerUnits="userSpaceOnUse"
						markerWidth={arrowWidth / zoom}
						markerHeight={(arrowWidth * 0.8) / zoom}
						orient="auto">
						{edge.kind === "transition" ? (
							<path d="M 1 1 L 11 5 L 1 9" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" />
						) : (
							<path d="M 0 0 L 12 5 L 0 10 L 2.5 5 Z" fill={stroke} />
						)}
					</marker>
				</defs>
			)}
			<BaseEdge
				path={route.path}
				markerEnd={edge.kind === "aggregation" || terminalRoute ? undefined : `url(#${markerId})`}
				interactionWidth={0}
				style={{
					stroke,
					strokeWidth: strokeWidth / zoom,
					strokeDasharray:
						edge.kind === "dependency"
							? style.dependencyDash.map((length) => length / zoom).join(" ")
							: edge.kind === "data_flow"
								? style.dataDash.map((length) => length / zoom).join(" ")
								: edge.kind === "message"
									? style.messageDash.map((length) => length / zoom).join(" ")
									: undefined,
					strokeLinecap: "round",
					opacity,
				}}
			/>
			{terminalRoute && edge.kind !== "aggregation" && (
				<path
					d={`M ${terminalRoute[0].x} ${terminalRoute[0].y} L ${terminalRoute[1].x} ${terminalRoute[1].y}`}
					fill="none"
					stroke="none"
					markerEnd={`url(#${markerId})`}
					style={{ opacity }}
				/>
			)}
			<path
				d={"interactionPath" in route ? route.interactionPath : route.path}
				className="react-flow__edge-interaction"
				fill="none"
				stroke="transparent"
				strokeWidth={28 / zoom}
			/>
			{edge.kind === "aggregation" && (
				<path
					d="M 0 0 l 7 -4.5 l 7 4.5 l -7 4.5 Z"
					transform={`translate(${start.x} ${start.y}) rotate(${angle}) scale(${1 / zoom})`}
					strokeWidth={strokeWidth}
					fill="var(--board-surface)"
					stroke={stroke}
					style={{ opacity }}
				/>
			)}
			{visible || edge.change || data?.comments?.pending || data?.comments?.sent ? (
				<EdgeLabelRenderer>
					<div
						className={`board-edge-label${selected ? " is-selected" : ""}${data?.dimmed ? " is-dimmed" : ""}`}
						style={{
							transform: `translate(${route.label.x}px, ${route.label.y}px) scale(${1 / zoom}) translate(-50%, -50%)`,
							transformOrigin: "0 0",
							borderLeftColor: stroke,
						}}>
						{visible && (
							<>
								<span className="edge-kind">{edge.kind.replaceAll("_", " ")}</span>
								<span className="edge-title" dir="auto" title={edge.label}>
									{edge.label ?? "Unlabeled relationship"}
								</span>
							</>
						)}
						{edge.change && <span className={`proposal change-${edge.change}`}>Proposed: {edge.change}</span>}
						<CommentBadges counts={data?.comments} />
					</div>
				</EdgeLabelRenderer>
			) : null}
		</>
	)
}

export const boardNodeTypes = { architecture: ArchitectureNodeView }
export const boardEdgeTypes = { architecture: ArchitectureEdgeView }
