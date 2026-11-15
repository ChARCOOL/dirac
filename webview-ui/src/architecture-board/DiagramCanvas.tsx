import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
	ReactFlow,
	useNodesState,
	useEdgesState,
	useNodesInitialized,
	useReactFlow,
	Background,
	BackgroundVariant,
	type NodeChange,
} from "@xyflow/react"
import type { ArchitectureDiagram, ArchitecturePresentation, ResolvedArchitectureIdentity } from "@shared/architecture"
import { boardNodeTypes, boardEdgeTypes } from "./FlowElements"
import {
	toFlowGraph,
	sizeGroups,
	restoreUnchangedGroupSizes,
	applyLayoutPorts,
	fixedLayoutFromNodes,
	STRUCTURE_LOCK,
	type BoardNode,
	type BoardEdge,
} from "./flowGraph"
import { layoutBoard } from "./layoutBoard"
import { Inspector, type BoardTarget } from "./Inspector"
import type { PresentationSaves } from "./PresentationSaves"
import type { CommentReviews, CommentReview } from "./CommentReviews"
import { countTargetComments } from "./CommentBadges"
import { CanvasToolbar } from "./CanvasToolbar"
import { RelationshipLegend } from "./RelationshipLegend"
import { SelectionPopover } from "./SelectionPopover"
import { useBoardStyle } from "./styles/StyleContext"
import { FIT_PADDING } from "./layoutGraph"
import { useViewportRefit } from "./useViewportRefit"
import { measureNodeSizes } from "./measureText"
import { MIN_READING_ZOOM } from "./textLayout"
import { CopyDiagramImage } from "./image-export/CopyDiagramImage"

export function DiagramCanvas({
	diagram,
	presentationControls,
	utilityControls,
	overviewRequest = 0,
	fullscreen = false,
	identity,
	presentation,
	saves,
	reviews,
	review,
}: {
	diagram: ArchitectureDiagram
	summary: string
	presentationControls?: ReactNode
	utilityControls?: ReactNode
	overviewRequest?: number
	fullscreen?: boolean
	identity: ResolvedArchitectureIdentity
	presentation?: ArchitecturePresentation
	saves: PresentationSaves
	reviews: CommentReviews
	review?: CommentReview
}) {
	const workspace = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLDivElement>(null)
	const style = useBoardStyle()
	const requestedGeometry = useRef(style.geometry)
	const [initial] = useState(() =>
		toFlowGraph(diagram, saves.get(identity)?.presentation ?? presentation, measureNodeSizes(diagram)),
	)
	const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
	const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
	const [target, setTarget] = useState<BoardTarget>()
	const [sidebar, setSidebar] = useState(false)
	const [labels, setLabels] = useState(false)
	const [hoveredEdge, setHoveredEdge] = useState<string>()
	const [layoutError, setLayoutError] = useState<string>()
	const [arranging, setArranging] = useState(false)
	const initialized = useNodesInitialized()
	const flow = useReactFlow<BoardNode, BoardEdge>()
	const controller = useRef<AbortController>()
	const rerouteFrame = useRef<number>()
	const started = useRef(false)
	const ready = useRef(false)
	const saved = useRef(saves.get(identity)?.presentation ?? presentation)
	const persist = useCallback(() => {
		if (!ready.current || controller.current) return
		saves.save(identity, {
			positions: Object.fromEntries(flow.getNodes().map((node) => [node.id, node.position])),
			viewport: flow.getViewport(),
		})
	}, [flow, saves, identity])
	const fit = useCallback(() => {
		const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200
		void flow.fitView({ padding: FIT_PADDING, maxZoom: 1, duration }).then(persist)
	}, [flow, persist])
	useViewportRefit(fullscreen, initialized && !arranging, fit)
	const arrange = useCallback(
		async (restore = false, routeOnly = false) => {
			if (rerouteFrame.current !== undefined) cancelAnimationFrame(rerouteFrame.current)
			rerouteFrame.current = undefined
			controller.current?.abort()
			const current = new AbortController()
			controller.current = current
			setArranging(true)
			setLayoutError(undefined)
			try {
				let result = await layoutBoard(
					{
						diagram,
						styleId: style.id,
						canvas: { width: canvas.current!.clientWidth, height: canvas.current!.clientHeight },
						fixedLayout: routeOnly ? fixedLayoutFromNodes(flow.getNodes(), flow.getEdges()) : undefined,
						dimensions: Object.fromEntries(
							flow.getNodes().map((node) => [
								node.id,
								{
									width: node.measured!.width!,
									height: node.measured!.height!,
								},
							]),
						),
					},
					current.signal,
				)
				if (current.signal.aborted) return
				const matchesPositions = (layout: typeof result) =>
					flow
						.getNodes()
						.every(
							(node) =>
								Math.abs(node.position.x - layout.positions[node.id].x) < 0.5 &&
								Math.abs(node.position.y - layout.positions[node.id].y) < 0.5,
						)
				// Older boards predate canvas-aware placement. Recover their original
				// port seeds without replacing any saved positions or viewport.
				if (restore && !routeOnly && !matchesPositions(result)) {
					result = await layoutBoard({ diagram, styleId: style.id, dimensions: result.sizes }, current.signal)
					if (current.signal.aborted) return
				}
				// Reuse exact arranged ports when possible; otherwise route saved/live geometry.
				if (restore && !routeOnly && !matchesPositions(result)) {
					// A moved external node must not shrink unchanged subsystem frames on reopen.
					// Never import dimensions from a differently arranged subtree.
					const recovered = applyLayoutPorts(restoreUnchangedGroupSizes(flow.getNodes(), result), result)
					const fixedLayout = fixedLayoutFromNodes(recovered, flow.getEdges())
					result = await layoutBoard(
						{ diagram, styleId: style.id, dimensions: fixedLayout.sizes, fixedLayout },
						current.signal,
					)
					if (current.signal.aborted) return
				}
				setNodes((nodes) =>
					applyLayoutPorts(
						nodes.map((node) => ({
							...node,
							position: restore ? node.position : result.positions[node.id],
							...(node.data.semantic.kind === "group"
								? { style: { ...node.style, ...result.sizes[node.id] } }
								: {}),
						})),
						result,
					),
				)
				setEdges((edges) =>
					edges.map((edge) => ({
						...edge,
						data: { ...edge.data!, route: result.routes[edge.id], decorations: result.decorations?.[edge.id] },
					})),
				)
				await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
				if (current.signal.aborted) return
				if (!routeOnly && (!restore || !saved.current?.viewport))
					await flow.fitView({ padding: FIT_PADDING, minZoom: MIN_READING_ZOOM, maxZoom: 1 })
				ready.current = true
				controller.current = undefined
				if (!restore) persist()
			} catch (error) {
				if (!current.signal.aborted) setLayoutError(error instanceof Error ? error.message : String(error))
			} finally {
				if (controller.current === current) controller.current = undefined
				if (!current.signal.aborted) setArranging(false)
			}
		},
		[diagram, flow, persist, setNodes, setEdges, style.id],
	)
	useEffect(() => {
		if (!initialized || started.current) return
		started.current = true
		const restore = !!saved.current && diagram.nodes.every((node) => saved.current!.positions[node.id])
		if (restore) {
			setNodes((nodes) => sizeGroups(nodes))
			ready.current = true
			if (saved.current!.viewport) void flow.setViewport(saved.current!.viewport)
		}
		void arrange(restore)
	}, [initialized, diagram, arrange, flow, setNodes])
	useEffect(() => {
		if (!initialized || !started.current || requestedGeometry.current === style.geometry) return
		requestedGeometry.current = style.geometry
		// Palette switches preserve routes, positions and viewport. Only a different
		// silhouette requires docking again; arrange aborts any in-flight worker.
		setEdges((edges) => edges.map((edge) => ({ ...edge, data: { ...edge.data!, route: undefined, decorations: undefined } })))
		const restore = ready.current || (!!saved.current && diagram.nodes.every((node) => saved.current!.positions[node.id]))
		void arrange(restore, ready.current)
	}, [style.geometry, initialized, diagram, arrange, setEdges])
	useEffect(
		() => () => {
			ready.current = false
			controller.current?.abort()
			if (rerouteFrame.current !== undefined) cancelAnimationFrame(rerouteFrame.current)
		},
		[],
	)
	const select = (selection?: BoardTarget) => {
		setTarget(selection)
		setNodes((nodes) => nodes.map((node) => ({ ...node, selected: selection?.kind === "node" && selection.id === node.id })))
		setEdges((edges) => edges.map((edge) => ({ ...edge, selected: selection?.kind === "edge" && selection.id === edge.id })))
	}
	const preview = (selection: BoardTarget) => {
		select(selection)
		setSidebar(false)
	}
	const closeDetails = () => setSidebar(false)
	const clearPreview = () => {
		select(undefined)
		setHoveredEdge(undefined)
		workspace.current!.focus({ preventScroll: true })
	}
	const openDetails = () => setSidebar(true)
	const previousOverviewRequest = useRef(overviewRequest)
	useEffect(() => {
		if (overviewRequest === previousOverviewRequest.current) return
		previousOverviewRequest.current = overviewRequest
		setTarget(undefined)
		setHoveredEdge(undefined)
		setNodes((nodes) => nodes.map((node) => ({ ...node, selected: false })))
		setEdges((edges) => edges.map((edge) => ({ ...edge, selected: false })))
		setSidebar(true)
		workspace.current?.querySelector<HTMLElement>(".board-inspector")?.focus({ preventScroll: true })
	}, [overviewRequest, setNodes, setEdges])
	const previousSidebar = useRef(false)
	useLayoutEffect(() => {
		if (sidebar === previousSidebar.current) return
		previousSidebar.current = sidebar
		const destination =
			workspace.current!.querySelector<HTMLElement>(sidebar ? ".board-inspector" : ".selection-popover") ??
			workspace.current!
		destination.focus({ preventScroll: true })
	}, [sidebar])
	const descendants = useCallback(
		(id: string) => {
			const ids = new Set([id])
			// Flow nodes are parent-first, including nested groups.
			for (const node of nodes) if (node.parentId && ids.has(node.parentId)) ids.add(node.id)
			return ids
		},
		[nodes],
	)
	const focus = (id: string) => {
		workspace.current!.focus({ preventScroll: true })
		select({ kind: "node", id })
		const ids = descendants(id)
		requestAnimationFrame(() => {
			void flow
				.fitView({
					nodes: nodes.filter((node) => ids.has(node.id)),
					padding: 0.25,
					maxZoom: 1.2,
					minZoom: MIN_READING_ZOOM,
					duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200,
				})
				.then(persist)
		})
	}
	const highlighted = useMemo(() => {
		if (!target) return undefined
		const primary = target.kind === "node" ? descendants(target.id) : new Set<string>()
		const nodeIds = new Set(primary)
		const edgeIds = new Set<string>()
		for (const edge of edges) {
			if (target.kind === "edge" ? edge.id === target.id : primary.has(edge.source) || primary.has(edge.target)) {
				edgeIds.add(edge.id)
				nodeIds.add(edge.source)
				nodeIds.add(edge.target)
			}
		}
		for (const node of [...nodes].reverse()) if (nodeIds.has(node.id) && node.parentId) nodeIds.add(node.parentId)
		return { nodes: nodeIds, edges: edgeIds }
	}, [target, descendants, edges, nodes])
	const displayedNodes = useMemo(
		() =>
			nodes.map((node) => ({
				...node,
				data: {
					...node.data,
					comments: countTargetComments(review?.comments ?? [], { kind: "node", id: node.id }),
					dimmed: highlighted && !highlighted.nodes.has(node.id),
				},
			})),
		[nodes, review?.comments, highlighted],
	)
	const displayedEdges = useMemo(
		() =>
			edges.map((edge) => ({
				...edge,
				data: {
					...edge.data!,
					comments: countTargetComments(review?.comments ?? [], { kind: "edge", id: edge.id }),
					showLabel: labels || hoveredEdge === edge.id,
					emphasized: highlighted?.edges.has(edge.id) || hoveredEdge === edge.id,
					dimmed: highlighted && !highlighted.edges.has(edge.id) && hoveredEdge !== edge.id,
				},
			})),
		[edges, review?.comments, highlighted, hoveredEdge, labels],
	)
	const changeNodes = (changes: NodeChange<BoardNode>[]) => {
		onNodesChange(changes.filter((change) => change.type !== "remove" && change.type !== "add" && change.type !== "replace"))
		if (ready.current && !controller.current && changes.some((change) => change.type === "position")) {
			// No stale bridges during movement; recompute geometry without moving nodes on release.
			setEdges((edges) =>
				edges.map((edge) => ({ ...edge, data: { ...edge.data!, route: undefined, decorations: undefined } })),
			)
			if (changes.some((change) => change.type === "position" && change.dragging !== true)) {
				if (rerouteFrame.current !== undefined) cancelAnimationFrame(rerouteFrame.current)
				rerouteFrame.current = requestAnimationFrame(() => {
					persist()
					void arrange(true, true)
				})
			}
		}
	}
	return (
		<div
			ref={workspace}
			className="diagram-workspace"
			tabIndex={-1}
			onKeyDownCapture={(event) => {
				if (event.nativeEvent.isComposing) return
				// React Flow consumes Escape on focused nodes/edges. Dismiss local
				// overlays first, before its native keyboard-selection handler.
				if (event.key === "Escape") {
					// Toolbar menus/search handle Escape locally before closing inspection or Zen Mode.
					const activeControl = event.target as HTMLElement
					if (
						activeControl.closest(".canvas-layout-menu[open]") ||
						activeControl.matches('.board-search input[aria-expanded="true"]')
					)
						return
					const textual = workspace.current!.querySelector<HTMLDetailsElement>(".textual-diagram[open]")
					// Let an unhandled Escape reach the board's native-window action.
					if (!sidebar && !target && !textual) return
					event.preventDefault()
					event.stopPropagation()
					if (event.repeat) return
					if (sidebar) {
						closeDetails()
						return
					}
					if (!target && textual) textual.open = false
					clearPreview()
					return
				}
				if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return
				const element = event.target as HTMLElement
				if (!element.matches(".react-flow__node, .react-flow__edge")) return
				event.preventDefault()
				event.stopPropagation()
				preview({ kind: element.matches(".react-flow__node") ? "node" : "edge", id: element.dataset.id! })
			}}>
			<CanvasToolbar
				diagram={diagram}
				presentationControls={presentationControls}
				utilityControls={utilityControls}
				exportControls={
					<CopyDiagramImage
						disabled={!initialized || arranging || !!layoutError}
						labels={labels}
						filename={`${identity.name}-v${identity.version}`}
					/>
				}
				arranging={arranging}
				initialized={initialized}
				labels={labels}
				fit={fit}
				arrange={() => void arrange()}
				persist={persist}
				jump={focus}
				toggleLabels={() => setLabels((show) => !show)}
				cancel={() => {
					controller.current?.abort()
					controller.current = undefined
					setArranging(false)
					setLayoutError("Layout cancelled. Try Redraw or use the textual diagram.")
				}}
			/>
			{layoutError && (
				<div role="alert">
					{layoutError}
					<button onClick={() => void arrange()}>Retry layout</button>
				</div>
			)}
			<div className={`canvas-inspector${sidebar ? " inspector-open" : ""}`}>
				<div ref={canvas} className="board-canvas" aria-label={`Graph version ${identity.version}`}>
					<ReactFlow
						nodes={displayedNodes}
						edges={displayedEdges}
						nodeTypes={boardNodeTypes}
						edgeTypes={boardEdgeTypes}
						{...STRUCTURE_LOCK}
						nodesDraggable={!arranging}
						selectNodesOnDrag={false}
						nodeDragThreshold={4}
						nodeClickDistance={4}
						paneClickDistance={4}
						minZoom={0.05}
						maxZoom={3}
						elevateEdgesOnSelect
						onNodesChange={changeNodes}
						onEdgesChange={(changes) => onEdgesChange(changes.filter((change) => change.type === "select"))}
						onNodeClick={(_, node) => preview({ kind: "node", id: node.id })}
						onNodeDoubleClick={(_, node) => focus(node.id)}
						onEdgeClick={(_, edge) => preview({ kind: "edge", id: edge.id })}
						onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
						onEdgeMouseLeave={() => setHoveredEdge(undefined)}
						onPaneClick={() => select(undefined)}
						onMoveEnd={(event) => {
							if (event) persist()
						}}>
						<Background
							variant={style.grid === "lines" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
							color="var(--board-grid)"
							gap={24}
							size={1}
						/>
					</ReactFlow>
					{target && !sidebar && (
						<SelectionPopover
							diagram={diagram}
							identity={identity}
							review={review}
							reviews={reviews}
							target={target}
							edge={target.kind === "edge" ? edges.find((edge) => edge.id === target.id) : undefined}
							more={openDetails}
							close={clearPreview}
						/>
					)}
					<div className="canvas-hint">
						<RelationshipLegend kinds={diagram.edges.map((edge) => edge.kind)} />
						{target ? (
							<>
								<span>Connected relationships highlighted</span>
								<button onClick={() => select(undefined)}>Clear selection</button>
							</>
						) : (
							<span>Drag empty space to pan · Drag cards or group headers to move · Click to explore</span>
						)}
					</div>
				</div>
				<div className="inspector-container" hidden={!sidebar}>
					<Inspector
						diagram={diagram}
						identity={identity}
						target={target}
						select={select}
						review={review}
						reviews={reviews}
						close={closeDetails}
						focus={focus}
					/>
				</div>
			</div>
			<details className="textual-diagram" open={!!layoutError}>
				<summary>
					Textual diagram · {diagram.nodes.length} nodes · {diagram.edges.length} relationships
				</summary>
				<div className="textual-content">
					<ul>
						{diagram.nodes.map((node) => (
							<li key={node.id}>
								<button onClick={() => focus(node.id)}>{node.label}</button> · {node.kind} — {node.description}
							</li>
						))}
					</ul>
					<ul>
						{diagram.edges.map((edge) => (
							<li key={edge.id}>
								<button onClick={() => select({ kind: "edge", id: edge.id })}>
									{diagram.nodes.find((node) => node.id === edge.source)?.label} →{" "}
									{diagram.nodes.find((node) => node.id === edge.target)?.label}
								</button>{" "}
								· {edge.kind}: {edge.label} {edge.description}
							</li>
						))}
					</ul>
				</div>
			</details>
		</div>
	)
}
