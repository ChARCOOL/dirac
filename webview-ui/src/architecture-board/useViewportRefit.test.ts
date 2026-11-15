import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useViewportRefit } from "./useViewportRefit"

describe("viewport refit", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it("preserves the initial viewport and refits on both confirmed mode transitions", () => {
		const fit = vi.fn()
		const { rerender } = renderHook(({ fullscreen }) => useViewportRefit(fullscreen, true, fit), {
			initialProps: { fullscreen: false },
		})
		act(() => vi.advanceTimersByTime(150))
		expect(fit).not.toHaveBeenCalled()
		for (const fullscreen of [true, false]) {
			rerender({ fullscreen })
			act(() => vi.advanceTimersByTime(150))
		}
		expect(fit).toHaveBeenCalledTimes(2)
		rerender({ fullscreen: false })
		act(() => vi.advanceTimersByTime(150))
		expect(fit).toHaveBeenCalledTimes(2)
	})

	it("coalesces resize events and also catches a late native fullscreen resize", () => {
		const fit = vi.fn()
		const { rerender } = renderHook(({ fullscreen }) => useViewportRefit(fullscreen, true, fit), {
			initialProps: { fullscreen: false },
		})
		rerender({ fullscreen: true })
		act(() => {
			vi.advanceTimersByTime(100)
			window.dispatchEvent(new Event("resize"))
			vi.advanceTimersByTime(100)
			window.dispatchEvent(new Event("resize"))
			vi.advanceTimersByTime(149)
		})
		expect(fit).not.toHaveBeenCalled()
		act(() => vi.advanceTimersByTime(1))
		expect(fit).toHaveBeenCalledOnce()
		act(() => {
			window.dispatchEvent(new Event("resize"))
			vi.advanceTimersByTime(150)
		})
		expect(fit).toHaveBeenCalledTimes(2)
	})

	it("retains a pending refit until initialization or arrangement completes", () => {
		const fit = vi.fn()
		const { rerender } = renderHook(({ fullscreen, enabled }) => useViewportRefit(fullscreen, enabled, fit), {
			initialProps: { fullscreen: false, enabled: false },
		})
		rerender({ fullscreen: true, enabled: false })
		act(() => {
			window.dispatchEvent(new Event("resize"))
			vi.advanceTimersByTime(1000)
		})
		expect(fit).not.toHaveBeenCalled()
		rerender({ fullscreen: true, enabled: true })
		act(() => vi.advanceTimersByTime(150))
		expect(fit).toHaveBeenCalledOnce()
	})

	it("cancels pending work and the resize listener on unmount", () => {
		const fit = vi.fn()
		const { rerender, unmount } = renderHook(({ fullscreen }) => useViewportRefit(fullscreen, true, fit), {
			initialProps: { fullscreen: false },
		})
		rerender({ fullscreen: true })
		unmount()
		act(() => {
			window.dispatchEvent(new Event("resize"))
			vi.advanceTimersByTime(1000)
		})
		expect(fit).not.toHaveBeenCalled()
	})
})
