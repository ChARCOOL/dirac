import LayoutWorker from "./layout.worker?worker&inline"
import { LAYOUT_LIMITS, type LayoutInput, type LayoutOutput } from "./layoutGraph"

/** One bounded worker per layout, terminated on success, failure, timeout or cancellation. */
export function layoutBoard(
	input: LayoutInput,
	signal: AbortSignal,
	createWorker: () => Worker = () => new LayoutWorker(),
): Promise<LayoutOutput> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new Error("Layout cancelled"))
			return
		}
		const worker = createWorker()
		let settled = false
		const finish = (error?: Error, result?: LayoutOutput) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			signal.removeEventListener("abort", cancel)
			worker.terminate()
			if (error) reject(error)
			else resolve(result!)
		}
		const cancel = () => finish(new Error("Layout cancelled"))
		const timer = setTimeout(
			() => finish(new Error("Layout exceeded its 10-second limit. Retry Redraw or use the textual diagram.")),
			LAYOUT_LIMITS.timeoutMs,
		)
		signal.addEventListener("abort", cancel, { once: true })
		worker.onmessage = (event: MessageEvent<{ result: LayoutOutput } | { error: string }>) => {
			if (settled) return
			if ("error" in event.data) {
				finish(new Error(event.data.error))
				return
			}
			finish(undefined, event.data.result)
		}
		worker.onerror = (event) => {
			event.preventDefault()
			finish(new Error(event.message || "Layout worker unavailable"))
		}
		try {
			worker.postMessage(input)
		} catch (error) {
			finish(error instanceof Error ? error : new Error(String(error)))
		}
	})
}
