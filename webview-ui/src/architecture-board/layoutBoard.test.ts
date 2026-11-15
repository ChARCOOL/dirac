import { afterEach, describe, expect, it, vi } from "vitest"
import { layoutBoard } from "./layoutBoard"

const input = { diagram: { title: "Empty", summary: "Empty", nodes: [], edges: [] }, dimensions: {} }
function fakeWorker() {
	return { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null } as unknown as Worker
}
afterEach(() => vi.useRealTimers())
describe("Bounded layout worker lifecycle", () => {
	it("sends semantic input once and terminates on success or worker-reported failure", async () => {
		const worker = fakeWorker()
		const promise = layoutBoard(input, new AbortController().signal, () => worker)
		expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith(input)
		const result = { positions: {}, sizes: {}, routes: {}, diagnostics: { selected: "unwrapped", candidates: [] } }
		worker.onmessage!({ data: { result } } as MessageEvent)
		await expect(promise).resolves.toEqual(result)
		expect(worker.terminate).toHaveBeenCalledOnce()
		const failed = fakeWorker()
		const rejection = layoutBoard(input, new AbortController().signal, () => failed)
		failed.onmessage!({ data: { error: "ELK failed" } } as MessageEvent)
		await expect(rejection).rejects.toThrow("ELK failed")
		expect(failed.terminate).toHaveBeenCalledOnce()
	})
	it("cancels and kills stale layout rather than accepting its reply", async () => {
		const signal = new AbortController()
		const worker = fakeWorker()
		const promise = layoutBoard(input, signal.signal, () => worker)
		signal.abort()
		worker.onmessage!({ data: { result: { positions: {}, sizes: {}, routes: {} } } } as MessageEvent)
		await expect(promise).rejects.toThrow(/cancelled/)
		expect(worker.terminate).toHaveBeenCalledOnce()
		const factory = vi.fn()
		await expect(layoutBoard(input, signal.signal, factory)).rejects.toThrow(/cancelled/)
		expect(factory).not.toHaveBeenCalled()
	})
	it("terminates the whole candidate search at the shared deadline and handles transport failure", async () => {
		vi.useFakeTimers()
		const worker = fakeWorker()
		const promise = layoutBoard(input, new AbortController().signal, () => worker)
		const rejection = expect(promise).rejects.toThrow(/10-second/)
		await vi.advanceTimersByTimeAsync(10001)
		await rejection
		expect(worker.terminate).toHaveBeenCalledOnce()
		const broken = fakeWorker()
		vi.mocked(broken.postMessage).mockImplementation(() => {
			throw new Error("clone failure")
		})
		await expect(layoutBoard(input, new AbortController().signal, () => broken)).rejects.toThrow(/clone failure/)
		expect(broken.terminate).toHaveBeenCalledOnce()
	})
	it("surfaces worker startup/runtime errors and cleans up", async () => {
		const worker = fakeWorker()
		const promise = layoutBoard(input, new AbortController().signal, () => worker)
		const event = { message: "worker unavailable", preventDefault: vi.fn() }
		worker.onerror!(event as unknown as ErrorEvent)
		await expect(promise).rejects.toThrow("worker unavailable")
		expect(event.preventDefault).toHaveBeenCalledOnce()
		expect(worker.terminate).toHaveBeenCalledOnce()
	})
})
