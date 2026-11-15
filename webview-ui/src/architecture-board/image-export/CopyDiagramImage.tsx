import { useEffect, useRef, useState } from "react"
import { Check, Copy, Download, LoaderCircle, X } from "lucide-react"
import { useReactFlow } from "@xyflow/react"
import type { BoardEdge, BoardNode } from "../flowGraph"
import { useBoardStyle } from "../styles/StyleContext"
import { createExportSnapshot } from "./exportSnapshot"
import { renderDiagramImage } from "./renderDiagramImage"
import { writeImageToClipboard } from "./imageClipboard"

type ExportStatus = { kind: "working" } | { kind: "copied" } | { kind: "failed"; message: string; image?: Blob }

/** Per-pane image actions; neither the task layer nor the controller knows about screenshot generation. */
export function CopyDiagramImage({ disabled, labels, filename }: { disabled: boolean; labels: boolean; filename: string }) {
	const flow = useReactFlow<BoardNode, BoardEdge>()
	const style = useBoardStyle()
	const [status, setStatus] = useState<ExportStatus>()
	const operation = useRef<AbortController>()
	const [downloadUrl, setDownloadUrl] = useState<string>()
	useEffect(() => () => operation.current?.abort(), [])
	useEffect(() => {
		if (status?.kind !== "copied") return
		const timeout = setTimeout(() => setStatus(undefined), 3000)
		return () => clearTimeout(timeout)
	}, [status])
	useEffect(() => {
		if (status?.kind !== "failed" || !status.image) {
			setDownloadUrl(undefined)
			return
		}
		const url = URL.createObjectURL(status.image)
		setDownloadUrl(url)
		return () => URL.revokeObjectURL(url)
	}, [status])

	const copy = async () => {
		if (operation.current) return
		const controller = new AbortController()
		operation.current = controller
		setStatus({ kind: "working" })
		try {
			const nodes = flow.getNodes()
			const edges = flow.getEdges()
			// Allow the busy state to paint before snapshotting and rendering the export.
			// Keep the clipboard write below in the original click event for user activation.
			const image = new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			}).then(() => {
				controller.signal.throwIfAborted()
				const snapshot = createExportSnapshot(nodes, edges, labels)
				return renderDiagramImage(snapshot, style, controller.signal)
			})
			// Both promises are observed immediately, including clipboard rejection before rasterization finishes.
			const [rendered, copied] = await Promise.allSettled([image, writeImageToClipboard(image)])
			if (controller.signal.aborted) return
			if (rendered.status === "rejected") throw rendered.reason
			if (copied.status === "rejected") {
				const reason = copied.reason instanceof Error ? copied.reason.message : String(copied.reason)
				setStatus({
					kind: "failed",
					message: `Image created, but clipboard access failed: ${reason}`,
					image: rendered.value,
				})
				return
			}
			setStatus({ kind: "copied" })
		} catch (error) {
			if (!controller.signal.aborted)
				setStatus({ kind: "failed", message: error instanceof Error ? error.message : String(error) })
		} finally {
			if (operation.current === controller) operation.current = undefined
		}
	}
	return (
		<div className="diagram-image-action">
			<button
				aria-label="Copy image"
				aria-busy={status?.kind === "working"}
				disabled={disabled || status?.kind === "working"}
				onClick={() => void copy()}
				title="Copy the whole diagram as a 2× PNG, using the current style and Labels setting">
				{status?.kind === "working" ? (
					<span className="diagram-image-status diagram-image-spinner" role="status" aria-label="Preparing image">
						<LoaderCircle size={15} aria-hidden="true" />
					</span>
				) : status?.kind === "copied" ? (
					<span className="diagram-image-status diagram-image-copied" role="status" aria-label="Diagram image copied">
						<Check size={15} aria-hidden="true" />
					</span>
				) : (
					<Copy size={15} aria-hidden="true" />
				)}
				<span className="toolbar-label">Copy image</span>
			</button>
			{status?.kind === "failed" && (
				<div className="diagram-image-notice" role="alert">
					<span>{status.message}</span>
					{downloadUrl && (
						<a href={downloadUrl} download={`${filename}.png`}>
							<Download size={14} aria-hidden="true" />
							Download PNG
						</a>
					)}
					<button aria-label="Dismiss image notification" onClick={() => setStatus(undefined)}>
						<X size={14} />
					</button>
				</div>
			)}
		</div>
	)
}
