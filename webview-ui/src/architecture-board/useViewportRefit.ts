import { useEffect, useRef } from "react"

/** Native fullscreen can resize the webview after the host confirms its mode. */
export function useViewportRefit(fullscreen: boolean, enabled: boolean, fit: () => void) {
	const previousFullscreen = useRef(fullscreen)
	const pending = useRef(false)

	useEffect(() => {
		if (previousFullscreen.current !== fullscreen) {
			previousFullscreen.current = fullscreen
			pending.current = true
		}
		let timer: ReturnType<typeof setTimeout> | undefined
		const schedule = () => {
			clearTimeout(timer)
			if (!enabled || !pending.current) return
			// Coalesce native window/layout resize events and let React Flow measure first.
			timer = setTimeout(() => {
				pending.current = false
				fit()
			}, 150)
		}
		const resize = () => {
			pending.current = true
			schedule()
		}
		schedule()
		window.addEventListener("resize", resize)
		return () => {
			clearTimeout(timer)
			window.removeEventListener("resize", resize)
		}
	}, [fullscreen, enabled, fit])
}
