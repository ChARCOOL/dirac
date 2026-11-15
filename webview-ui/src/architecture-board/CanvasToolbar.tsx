import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useReactFlow, useViewport } from "@xyflow/react"
import { Maximize, RotateCw, ChevronDown, Search, Tags, Minus, Plus, X } from "lucide-react"
import type { ArchitectureDiagram } from "@shared/architecture"
import { NODE_KIND_LABELS } from "./nodeShapes"
import { MIN_READING_ZOOM } from "./textLayout"

export function CanvasToolbar({
	diagram,
	presentationControls,
	utilityControls,
	exportControls,
	arranging,
	initialized,
	labels,
	fit,
	arrange,
	cancel,
	toggleLabels,
	jump,
	persist,
}: {
	diagram: ArchitectureDiagram
	presentationControls?: ReactNode
	utilityControls?: ReactNode
	exportControls?: ReactNode
	arranging: boolean
	initialized: boolean
	labels: boolean
	fit: () => void
	arrange: () => void
	cancel: () => void
	toggleLabels: () => void
	jump: (id: string) => void
	persist: () => void
}) {
	const flow = useReactFlow()
	const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160
	const { zoom } = useViewport()
	const [query, setQuery] = useState("")
	const [searching, setSearching] = useState(false)
	const searchId = useId()
	const layoutMenu = useRef<HTMLDetailsElement>(null)
	useEffect(() => {
		const dismiss = (event: PointerEvent) => {
			if (layoutMenu.current && !layoutMenu.current.contains(event.target as Node)) layoutMenu.current.open = false
		}
		document.addEventListener("pointerdown", dismiss)
		return () => document.removeEventListener("pointerdown", dismiss)
	}, [])
	const matches = diagram.nodes
		.filter((node) => `${node.label} ${node.kind} ${NODE_KIND_LABELS[node.kind]}`.toLowerCase().includes(query.toLowerCase()))
		.slice(0, 12)
	return (
		<div className="pane-toolbar" role="toolbar" aria-label="Diagram controls">
			<div
				className="board-search"
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) setSearching(false)
				}}>
				<Search size={14} aria-hidden="true" />
				<input
					aria-label="Find an element"
					placeholder="Find an element…"
					value={query}
					aria-controls={searchId}
					aria-expanded={searching}
					onFocus={() => setSearching(true)}
					onChange={(event) => {
						setQuery(event.target.value)
						setSearching(true)
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape" && searching) {
							setSearching(false)
							event.stopPropagation()
						}
						if (event.key === "Enter" && matches[0]) {
							jump(matches[0].id)
							setSearching(false)
							event.currentTarget.blur()
						}
					}}
				/>
				{searching && (
					<div className="search-results" id={searchId}>
						{matches.length ? (
							matches.map((node) => (
								<button
									key={node.id}
									onClick={() => {
										jump(node.id)
										setQuery("")
										setSearching(false)
									}}>
									<span>{node.label}</span>
									<small>{NODE_KIND_LABELS[node.kind]}</small>
								</button>
							))
						) : (
							<p>No matching elements</p>
						)}
					</div>
				)}
			</div>
			{presentationControls}
			<button
				aria-label="Labels"
				onClick={toggleLabels}
				aria-pressed={labels}
				title="Show all relationship labels; hover or select to read one">
				<Tags size={15} />
				<span className="toolbar-label">Labels</span>
			</button>
			<div className="toolbar-spacer" />
			<div className="zoom-controls">
				<button aria-label="Zoom out" title="Zoom out" onClick={() => void flow.zoomOut({ duration }).then(persist)}>
					<Minus size={14} />
				</button>
				<button
					className="zoom-level"
					title={zoom < MIN_READING_ZOOM ? "Overview scale — reset to 100% to read labels" : "Reset to 100%"}
					aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to 100%`}
					onClick={() => void flow.zoomTo(1, { duration }).then(persist)}>
					{Math.round(zoom * 100)}%
				</button>
				<button aria-label="Zoom in" title="Zoom in" onClick={() => void flow.zoomIn({ duration }).then(persist)}>
					<Plus size={14} />
				</button>
			</div>
			<div className="canvas-fit-control">
				<button
					aria-label="Fit"
					onClick={fit}
					disabled={arranging || !initialized}
					title="Fit the whole diagram without moving elements">
					<Maximize size={15} />
					<span className="toolbar-label">Fit</span>
				</button>
				<details
					ref={layoutMenu}
					className="canvas-layout-menu"
					onBlur={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape" && event.currentTarget.open) {
							event.currentTarget.open = false
							event.currentTarget.querySelector("summary")?.focus()
							event.stopPropagation()
						}
					}}>
					<summary aria-label="Layout options" title="Layout options">
						<ChevronDown size={14} />
					</summary>
					<div className="layout-menu-content">
						<button
							aria-label="Redraw"
							disabled={arranging || !initialized}
							title="Recalculate positions and connections at readable zoom. Replaces manual positioning; use Fit for the full overview."
							onClick={() => {
								layoutMenu.current!.open = false
								layoutMenu.current!.querySelector("summary")?.focus()
								arrange()
							}}>
							<RotateCw size={15} />
							Redraw
						</button>
						<p>
							Replaces manual positioning at readable zoom. Pan to explore, or use Fit for the whole diagram.
							Content stays unchanged.
						</p>
					</div>
				</details>
			</div>
			{exportControls}
			{utilityControls}
			{arranging && (
				<div className="arranging-status" role="status">
					Redrawing…
					<button aria-label="Cancel layout" onClick={cancel}>
						<X size={13} />
						Cancel
					</button>
				</div>
			)}
		</div>
	)
}
