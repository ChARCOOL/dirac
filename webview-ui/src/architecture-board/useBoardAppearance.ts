import { useSyncExternalStore } from "react"

export type BoardAppearance = "light" | "dark"

/** VS Code's selected theme takes precedence over the operating-system appearance. */
function readAppearance(): BoardAppearance {
	const classes = document.body.classList
	if (classes.contains("vscode-light") || classes.contains("vscode-high-contrast-light")) return "light"
	if (classes.contains("vscode-dark") || classes.contains("vscode-high-contrast")) return "dark"
	return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

function subscribe(onChange: () => void) {
	const observer = new MutationObserver(onChange)
	observer.observe(document.body, { attributes: true, attributeFilter: ["class"] })
	const media = window.matchMedia?.("(prefers-color-scheme: light)")
	media?.addEventListener("change", onChange)
	return () => {
		observer.disconnect()
		media?.removeEventListener("change", onChange)
	}
}

export function useBoardAppearance(): BoardAppearance {
	return useSyncExternalStore(subscribe, readAppearance, () => "dark")
}
