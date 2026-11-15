import { afterEach, describe, expect, it, vi } from "vitest"
import { BoardClient } from "./boardClient"

vi.mock("@/config/platform.config", () => ({
	PLATFORM_CONFIG: { postMessage: vi.fn(), encodeMessage: (value: unknown) => value, decodeMessage: (value: unknown) => value },
}))

describe("Bounded board transport", () => {
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})
	it("times out a stalled board read and removes its response listener", async () => {
		vi.useFakeTimers()
		const removed = vi.spyOn(window, "removeEventListener")
		const request = BoardClient.read("owner")
		const rejected = expect(request).rejects.toThrow("timed out")
		await vi.advanceTimersByTimeAsync(10_000)
		await rejected
		expect(removed).toHaveBeenCalledWith("message", expect.any(Function))
	})
	it("times out stalled transcript navigation and releases the transport listener", async () => {
		vi.useFakeTimers()
		const removed = vi.spyOn(window, "removeEventListener")
		const request = BoardClient.open({ taskId: "owner", name: "tools", mode: "latest" })
		const rejected = expect(request).rejects.toThrow("openArchitectureBoard timed out")
		await vi.advanceTimersByTimeAsync(15_000)
		await rejected
		expect(removed).toHaveBeenCalledWith("message", expect.any(Function))
	})
})
