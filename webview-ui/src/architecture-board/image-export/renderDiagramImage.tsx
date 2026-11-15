import { Component, useEffect, type PropsWithChildren } from "react"
import { createRoot } from "react-dom/client"
import { ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type ReactFlowInstance } from "@xyflow/react"
import { toBlob } from "html-to-image"
import { boardEdgeTypes, boardNodeTypes } from "../FlowElements"
import { STRUCTURE_LOCK, type BoardEdge, type BoardNode } from "../flowGraph"
import { BoardStyleContext } from "../styles/StyleContext"
import type { BoardStyle } from "../styles/types"
import fontEmbedCSS from "../fonts/fonts.css?inline"
import { imageDimensions, snapshotBounds, type ExportSnapshot, type ImageBounds } from "./exportSnapshot"
import "./imageExport.css"

type ExportFlow = ReactFlowInstance<BoardNode, BoardEdge>

function ExportReady({ ready }: { ready: (flow: ExportFlow) => void }) {
	const initialized = useNodesInitialized()
	const flow = useReactFlow<BoardNode, BoardEdge>()
	useEffect(() => {
		if (initialized) ready(flow)
	}, [initialized, ready, flow])
	return null
}

class ExportRenderBoundary extends Component<PropsWithChildren<{ failed: (error: Error) => void }>, { failed: boolean }> {
	state = { failed: false }
	static getDerivedStateFromError() {
		return { failed: true }
	}
	componentDidCatch(error: Error) {
		this.props.failed(error)
	}
	render() {
		return this.state.failed ? null : this.props.children
	}
}

const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/** Include labels and actual curves, not just node boxes: group headers and self-loops extend past them. */
function renderedBounds(host: HTMLElement, viewport: { x: number; y: number }): ImageBounds {
	const origin = host.getBoundingClientRect()
	const elements = host.querySelectorAll(".board-node, .node-title, .board-edge-label, .react-flow__edge > path, .proposal")
	let left = Infinity,
		top = Infinity,
		right = -Infinity,
		bottom = -Infinity
	for (const element of elements) {
		const box = element.getBoundingClientRect()
		left = Math.min(left, box.left)
		top = Math.min(top, box.top)
		right = Math.max(right, box.right)
		bottom = Math.max(bottom, box.bottom)
	}
	return { x: left - origin.left - viewport.x, y: top - origin.top - viewport.y, width: right - left, height: bottom - top }
}

/** Export owns its renderer and resources. No live viewport mutation, persistence, routing or host RPC. */
export async function renderDiagramImage(snapshot: ExportSnapshot, style: BoardStyle, signal: AbortSignal): Promise<Blob> {
	const initial = imageDimensions(snapshotBounds(snapshot))
	signal.throwIfAborted()
	const host = document.createElement("div")
	host.className = "architecture-board diagram-image-render"
	host.dataset.boardStyle = style.id
	host.setAttribute("aria-hidden", "true")
	host.inert = true
	Object.assign(host.style, { width: `${initial.width}px`, height: `${initial.height}px` })
	document.body.append(host)
	const root = createRoot(host)
	let timer: ReturnType<typeof setTimeout> | undefined
	let rejectReady: (error: Error) => void = () => {}
	const abort = () => rejectReady(new Error("Image export cancelled."))
	signal.addEventListener("abort", abort, { once: true })
	try {
		await document.fonts.ready
		signal.throwIfAborted()
		const flow = await new Promise<ExportFlow>((resolve, reject) => {
			rejectReady = reject
			timer = setTimeout(() => reject(new Error("The image renderer did not become ready. Try copying again.")), 10_000)
			root.render(
				<ExportRenderBoundary failed={reject}>
					<BoardStyleContext.Provider value={style}>
						<ReactFlowProvider>
							<ReactFlow<BoardNode, BoardEdge>
								nodes={snapshot.nodes}
								edges={snapshot.edges}
								nodeTypes={boardNodeTypes}
								edgeTypes={boardEdgeTypes}
								{...STRUCTURE_LOCK}
								defaultViewport={initial.viewport}
								minZoom={1}
								maxZoom={1}
								nodesDraggable={false}
								elementsSelectable={false}
								panOnDrag={false}
								zoomOnScroll={false}
								zoomOnDoubleClick={false}
								onError={(code, message) => reject(new Error(`Image renderer ${code}: ${message}`))}>
								<ExportReady ready={resolve} />
							</ReactFlow>
						</ReactFlowProvider>
					</BoardStyleContext.Provider>
				</ExportRenderBoundary>,
			)
		})
		clearTimeout(timer)
		await paint()
		signal.throwIfAborted()
		const dimensions = imageDimensions(renderedBounds(host, initial.viewport))
		Object.assign(host.style, { width: `${dimensions.width}px`, height: `${dimensions.height}px` })
		await flow.setViewport(dimensions.viewport)
		await paint()
		signal.throwIfAborted()
		const blob = await toBlob(host, {
			width: dimensions.width,
			height: dimensions.height,
			pixelRatio: dimensions.pixelRatio,
			backgroundColor: getComputedStyle(host).backgroundColor,
			fontEmbedCSS,
			skipAutoScale: true,
			// Reset logical insets too: Chromium serializes the offscreen position into both forms.
			style: { position: "relative", inset: "0", insetInline: "0", insetBlock: "0", margin: "0" },
			filter: (element) =>
				!element.classList?.contains("react-flow__handle") &&
				!element.classList?.contains("react-flow__attribution") &&
				!element.classList?.contains("react-flow__edge-interaction"),
		})
		signal.throwIfAborted()
		if (!blob) throw new Error("The browser could not encode the diagram as PNG.")
		return blob
	} finally {
		clearTimeout(timer)
		signal.removeEventListener("abort", abort)
		root.unmount()
		host.remove()
	}
}
