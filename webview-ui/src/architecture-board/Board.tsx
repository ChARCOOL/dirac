import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Network, RefreshCw, MoreHorizontal, PanelRight, Expand, Minimize } from "lucide-react"
import { VersionNavigation } from "./VersionNavigation"
import { DiagramPane } from "./DiagramPane"
import { PresentationSaves, presentationKey } from "./PresentationSaves"
import type { ArchitectureBoardView } from "@shared/proto/dirac/architecture"
import { BoardClient } from "./boardClient"
import type { ArchitectureSelection, ReviewComment } from "@shared/architecture"
import { CommentReviews } from "./CommentReviews"
import { ReviewSummary } from "./ReviewSummary"
import { SendFeedback } from "./SendFeedback"
import { boardStyles, resolveBoardStyle } from "./styles/catalog"
import { BoardStyleContext } from "./styles/StyleContext"
import { useBoardAppearance } from "./useBoardAppearance"

export function Board({
	taskId,
	nativeZenMode = false,
	initialStyle,
}: {
	taskId: string
	nativeZenMode?: boolean
	initialStyle?: string
}) {
	const [stylePreference, setStylePreference] = useState(initialStyle)
	const appearance = useBoardAppearance()
	const style = resolveBoardStyle(stylePreference, appearance)
	const [styleError, setStyleError] = useState<string>()
	const [saves] = useState(() => new PresentationSaves())
	const [reviews] = useState(() => new CommentReviews())
	const reviewStates = useSyncExternalStore(reviews.subscribe, reviews.getSnapshot)
	const saveStates = useSyncExternalStore(saves.subscribe, saves.getSnapshot)
	const [view, setView] = useState<ArchitectureBoardView>()
	const [error, setError] = useState<string>()
	const [viewError, setViewError] = useState<string>()
	const [fullscreen, setFullscreen] = useState(false)
	const [overviewRequest, setOverviewRequest] = useState(0)
	const boardRoot = useRef<HTMLDivElement>(null)
	const sequence = useRef(0)
	const load = useCallback(
		async (latest = false, selection?: ArchitectureSelection) => {
			const current = ++sequence.current
			const epoch = reviews.readEpoch()
			setError(undefined)
			try {
				const result = selection
					? await BoardClient.read(taskId, latest, selection)
					: await BoardClient.read(taskId, latest)
				if (current === sequence.current) {
					for (const pane of result.panes)
						reviews.hydrate(
							{ taskId, name: pane.name, version: pane.version },
							pane.commentsJson === undefined ? undefined : (JSON.parse(pane.commentsJson) as ReviewComment[]),
							epoch,
						)
					setView(result)
				}
			} catch (error) {
				if (current === sequence.current) setError(error instanceof Error ? error.message : String(error))
			}
		},
		[taskId, reviews],
	)
	useEffect(() => {
		const changed = (event: MessageEvent) => {
			if (event.data?.type === "architecture_board_changed" && event.data.taskId === taskId) void load()
			if (event.data?.type === "architecture_board_view_error") setViewError(event.data.error)
			if (event.data?.type === "architecture_board_style_state") {
				setStylePreference(event.data.style)
				setStyleError(undefined)
			}
			if (event.data?.type === "architecture_board_style_error") setStyleError(event.data.error)
		}
		window.addEventListener("message", changed)
		void load()
		return () => {
			sequence.current++
			window.removeEventListener("message", changed)
		}
	}, [taskId, load])
	useEffect(() => {
		if (!nativeZenMode) return
		const changed = (event: MessageEvent) => {
			if (event.data?.type === "architecture_board_view_state") setFullscreen(event.data.active)
		}
		// Canvas/background clicks can leave focus on <body>, outside React's root.
		// Catch bubbling Escape at document level, before VS Code's window-level forwarding.
		// Local overlays stop propagation first, so their staged Escape behavior still wins.
		const exitOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return
			event.preventDefault()
			event.stopPropagation()
			if (!event.repeat) BoardClient.requestView("exit_zen")
		}
		window.addEventListener("message", changed)
		document.addEventListener("keydown", exitOnEscape)
		BoardClient.requestView("ready")
		return () => {
			window.removeEventListener("message", changed)
			document.removeEventListener("keydown", exitOnEscape)
		}
	}, [nativeZenMode])
	useEffect(() => {
		const dismiss = (event: PointerEvent) => {
			for (const menu of boardRoot.current!.querySelectorAll<HTMLDetailsElement>(
				".board-version-menu[open], .board-overflow[open]",
			)) {
				if (!menu.contains(event.target as Node)) menu.open = false
			}
		}
		document.addEventListener("pointerdown", dismiss)
		return () => document.removeEventListener("pointerdown", dismiss)
	}, [])
	const presentationControls = (
		<label className="board-style-select">
			<select
				aria-label="Diagram style"
				title="Diagram style (applies to both comparison panes)"
				value={style.id}
				onChange={(event) => {
					setStyleError(undefined)
					setStylePreference(event.target.value)
					BoardClient.requestStyle(event.target.value)
				}}>
				{boardStyles.map((entry) => (
					<option key={entry.id} value={entry.id}>
						{entry.label}
					</option>
				))}
			</select>
		</label>
	)
	const utilityControls = (
		<details
			className="board-overflow"
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
			<summary aria-label="Board options" title="Board options">
				<MoreHorizontal size={15} />
			</summary>
			<div className="board-overflow-content">
				<button
					onClick={(event) => {
						const menu = event.currentTarget.closest("details")!
						menu.open = false
						menu.querySelector("summary")?.focus()
						void load()
					}}>
					<RefreshCw size={14} />
					Reload board
				</button>
			</div>
		</details>
	)
	return (
		<BoardStyleContext.Provider value={style}>
			<div ref={boardRoot} className="architecture-board" data-board-style={style.id}>
				<header className="board-header">
					<div className="board-brand">
						<Network size={16} aria-hidden="true" />
						<h1 title={view?.panes.length === 1 ? view.panes[0].title : "Architecture board"}>
							{view?.panes.length === 1 ? view.panes[0].title : "Architecture board"}
						</h1>
						{view?.panes.length === 1 && (
							<VersionNavigation
								key={`${view.panes[0].name}-${view.panes[0].version}`}
								taskId={taskId}
								name={view.panes[0].name}
								version={view.panes[0].version}
								latestVersion={view.latestVersion}
								latestVersionError={view.latestVersionError}
								followingLatest={view.selection?.mode === "latest"}
								navigate={(selection) => void load(false, selection)}
							/>
						)}
					</div>
					{view?.panes.length === 1 && (
						<button
							className="diagram-overview-button"
							aria-label="Diagram & comments"
							title="Diagram summary and general comments"
							onClick={() => setOverviewRequest((value) => value + 1)}>
							<PanelRight size={15} aria-hidden="true" />
							<span>Diagram & comments</span>
						</button>
					)}
					{view && (
						<SendFeedback taskId={taskId} view={view} reviews={reviews} disabled={!!error} refresh={() => load()} />
					)}
					{nativeZenMode && (
						<button
							className="fullscreen-button"
							aria-label={fullscreen ? "Press Esc to return" : "Go Fullscreen"}
							title={
								fullscreen
									? "Press Escape to close details and previews, then return. Or click here to return now. Drafts are kept."
									: "Enter VS Code Zen Mode using your existing fullscreen and layout preferences. No settings are changed."
							}
							onClick={() => {
								setViewError(undefined)
								BoardClient.requestView(fullscreen ? "exit_zen" : "enter_zen")
							}}>
							{fullscreen ? <Minimize size={16} aria-hidden="true" /> : <Expand size={16} aria-hidden="true" />}
							<span>{fullscreen ? "Press Esc to return" : "Go Fullscreen"}</span>
						</button>
					)}
				</header>
				<div className="presentation-notices">
					{styleError && (
						<div className="presentation-status" role="alert">
							Style preference not saved: {styleError}
							<button
								onClick={() => {
									setStyleError(undefined)
									BoardClient.requestStyle(style.id)
								}}>
								Retry
							</button>
						</div>
					)}
					{viewError && (
						<div className="presentation-status" role="alert">
							Could not change full screen (Zen Mode): {viewError}
							<button onClick={() => setViewError(undefined)}>Dismiss</button>
						</div>
					)}
					{saveStates
						.filter((entry) => entry.status !== "saved")
						.map((entry) => (
							<div
								className="presentation-status"
								key={presentationKey(entry.identity)}
								role={entry.status === "error" ? "alert" : "status"}>
								{entry.identity.name} v{entry.identity.version}:{" "}
								{entry.status === "saving" ? "Saving presentation…" : `Presentation not saved: ${entry.error}`}
								{entry.status === "error" && (
									<button onClick={() => saves.retry(entry.identity)}>Retry save</button>
								)}
							</div>
						))}
					{view && (
						<ReviewSummary
							taskId={taskId}
							view={view}
							reviews={reviewStates}
							navigate={(selection) => void load(false, selection)}
						/>
					)}
				</div>
				{error && (
					<div role="alert">
						<strong>Board unavailable:</strong> {error} <button onClick={() => void load()}>Retry</button>
						<p>Ordinary chat remains available. Previously loaded content below may be out of date.</p>
					</div>
				)}
				{!view && !error && <p role="status">Loading architecture…</p>}
				{view && (
					<>
						<div className={view.panes.length === 2 ? "panes comparison" : "panes"}>
							{view.panes.map((pane, index) => (
								<DiagramPane
									key={`${index}-${pane.name}-${pane.version}`}
									pane={pane}
									taskId={taskId}
									side={index === 0 ? "Left" : "Right"}
									comparison={view.panes.length === 2}
									fullscreen={fullscreen}
									overviewRequest={overviewRequest}
									presentationControls={index === 0 ? presentationControls : undefined}
									utilityControls={index === 0 ? utilityControls : undefined}
									versionControls={
										view.panes.length === 2 ? (
											<VersionNavigation
												taskId={taskId}
												name={pane.name}
												version={pane.version}
												latestVersion={view.latestVersion}
												latestVersionError={view.latestVersionError}
												comparison
												navigate={(selection) => {
													if (selection.mode !== "exact") return
													void load(false, {
														taskId,
														name: pane.name,
														mode: "comparison",
														startVersion: index === 0 ? selection.version : view.panes[0].version,
														endVersion: index === 1 ? selection.version : view.panes[1].version,
													})
												}}
											/>
										) : undefined
									}
									saves={saves}
									reviews={reviews}
									review={reviews.get({ taskId, name: pane.name, version: pane.version })}
								/>
							))}
						</div>
					</>
				)}
			</div>
		</BoardStyleContext.Provider>
	)
}
