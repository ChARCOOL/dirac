import { describe, expect, it, vi, beforeEach } from "vitest"
import { BoardClient } from "./boardClient"
import { PresentationSaves } from "./PresentationSaves"
vi.mock("./boardClient", () => ({ BoardClient: { save: vi.fn() } }))
const identity = { taskId: "owner", name: "tools", version: 1 }
const snapshot = (x: number) => ({ positions: { node: { x, y: 0 } } })
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
beforeEach(() => vi.mocked(BoardClient.save).mockReset())
describe("Presentation save queue", () => {
	it("coalesces rapid gestures and never lets an earlier response label a newer snapshot saved", async () => {
		let finish!: (value: {}) => void
		vi.mocked(BoardClient.save)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve
					}),
			)
			.mockResolvedValue({})
		const saves = new PresentationSaves()
		saves.save(identity, snapshot(1))
		saves.save(identity, snapshot(2))
		saves.save(identity, snapshot(3))
		expect(BoardClient.save).toHaveBeenCalledTimes(1)
		finish({})
		await tick()
		expect(BoardClient.save).toHaveBeenCalledTimes(2)
		expect(BoardClient.save).toHaveBeenLastCalledWith(identity, snapshot(3))
		expect(saves.get(identity)?.status).toBe("saved")
	})
	it("retains failures across version switches and retries only the original identity", async () => {
		vi.mocked(BoardClient.save).mockRejectedValueOnce(new Error("disk full")).mockResolvedValue({})
		const saves = new PresentationSaves()
		saves.save(identity, snapshot(1))
		await tick()
		expect(saves.get(identity)).toMatchObject({ presentation: snapshot(1), status: "error", error: "disk full" })
		saves.save({ ...identity, version: 2 }, snapshot(2))
		await tick()
		expect(saves.get(identity)?.status).toBe("error")
		saves.retry(identity)
		await tick()
		expect(BoardClient.save).toHaveBeenLastCalledWith(identity, snapshot(1))
		expect(saves.get(identity)?.status).toBe("saved")
	})
})
