import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { UnbiasedHandler } from "../unbiased"

const emptyStream = { [Symbol.asyncIterator]: async function* () { } }

describe("Unbiased request cancellation", () => {
	it("aborts an in-flight request and allows the next request to proceed", async () => {
		const handler = new UnbiasedHandler({ unbiasedApiKey: "test-key" })
		const signals: AbortSignal[] = []
		let requestStarted!: () => void
		const started = new Promise<void>((resolve) => {
			requestStarted = resolve
		})
		const create = (_params: unknown, options: { signal: AbortSignal }) => {
			signals.push(options.signal)
			if (signals.length > 1) return Promise.resolve(emptyStream)
			requestStarted()
			return new Promise<never>((_resolve, reject) => {
				options.signal.addEventListener("abort", () => reject(new Error("request aborted")), { once: true })
			})
		}
		Object.defineProperty(handler, "client", { value: { chat: { completions: { create } } } })

		const first = handler.createMessage("system", []).next()
		await started
		assert.equal(signals[0].aborted, false)
		handler.abort()
		await assert.rejects(first, /request aborted/)
		assert.equal(signals[0].aborted, true)

		for await (const _chunk of handler.createMessage("system", [])) {
			// Consume the next empty response.
		}
		assert.equal(signals.length, 2)
		assert.equal(signals[1].aborted, false)
	})
})
