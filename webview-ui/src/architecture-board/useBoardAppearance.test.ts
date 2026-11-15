import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useBoardAppearance } from "./useBoardAppearance"

afterEach(() => {
	// Unsubscribe before mutating the theme or restoring its browser API.
	cleanup()
	document.body.className = ""
	vi.restoreAllMocks()
})

describe("board appearance", () => {
	it.each([
		["vscode-light", "light"],
		["vscode-dark", "dark"],
		["vscode-high-contrast-light", "light"],
		["vscode-high-contrast", "dark"],
	] as const)("uses the host's %s appearance", (className, expected) => {
		document.body.className = className
		const { result } = renderHook(useBoardAppearance)
		expect(result.current).toBe(expected)
	})

	it("follows browser appearance changes only when no host theme is present and cleans up", async () => {
		let matches = true
		const events = new EventTarget()
		const remove = vi.spyOn(events, "removeEventListener")
		vi.spyOn(window, "matchMedia").mockImplementation(() => ({
			get matches() {
				return matches
			},
			media: "(prefers-color-scheme: light)",
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: events.addEventListener.bind(events),
			removeEventListener: events.removeEventListener.bind(events),
			dispatchEvent: events.dispatchEvent.bind(events),
		}))
		const { result, unmount } = renderHook(useBoardAppearance)
		expect(result.current).toBe("light")
		act(() => {
			matches = false
			events.dispatchEvent(new Event("change"))
		})
		expect(result.current).toBe("dark")
		await act(async () => {
			document.body.className = "vscode-light"
		})
		expect(result.current).toBe("light")
		act(() => {
			events.dispatchEvent(new Event("change"))
		})
		expect(result.current).toBe("light")
		unmount()
		expect(remove).toHaveBeenCalledWith("change", expect.any(Function))
	})
})
