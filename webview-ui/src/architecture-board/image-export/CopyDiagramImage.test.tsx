import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CopyDiagramImage } from "./CopyDiagramImage"

const mocks = vi.hoisted(() => ({
	render: vi.fn(),
	write: vi.fn(),
	snapshot: vi.fn(),
	revoke: vi.fn(),
	createUrl: vi.fn(),
	flow: { getNodes: vi.fn(() => []), getEdges: vi.fn(() => []) },
}))
vi.mock("@xyflow/react", () => ({ useReactFlow: () => mocks.flow }))
vi.mock("../styles/StyleContext", () => ({ useBoardStyle: () => ({ id: "earth" }) }))
vi.mock("./renderDiagramImage", () => ({ renderDiagramImage: mocks.render }))
vi.mock("./imageClipboard", () => ({ writeImageToClipboard: mocks.write }))
vi.mock("./exportSnapshot", () => ({ createExportSnapshot: mocks.snapshot }))

let frames: FrameRequestCallback[]

async function paintSpinner() {
	// Each callback batch represents a distinct frame, with a paint opportunity between them.
	for (let frame = 0; frame < 2; frame++) {
		await act(async () => {
			const callbacks = frames.splice(0)
			for (const callback of callbacks) callback(frame * 16)
		})
	}
}

beforeEach(() => {
	vi.resetAllMocks()
	frames = []
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback))
	mocks.snapshot.mockReturnValue({ nodes: [], edges: [] })
	mocks.createUrl.mockReturnValue("blob:diagram-image")
	vi.stubGlobal("URL", { createObjectURL: mocks.createUrl, revokeObjectURL: mocks.revoke })
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe("CopyDiagramImage", () => {
	it("passes the current label choice and does not report success before clipboard completion", async () => {
		vi.useFakeTimers()
		let finish!: () => void
		const image = Promise.resolve(new Blob(["png"], { type: "image/png" }))
		mocks.render.mockReturnValue(image)
		mocks.write.mockReturnValue(
			new Promise<void>((resolve) => {
				finish = resolve
			}),
		)
		const view = render(<CopyDiagramImage disabled={false} labels filename="checkout-v1" />)
		fireEvent.click(view.getByRole("button", { name: "Copy image" }))
		expect(mocks.snapshot).not.toHaveBeenCalled()
		expect(mocks.render).not.toHaveBeenCalled()
		expect(mocks.write).toHaveBeenCalledWith(expect.any(Promise))
		const button = view.getByRole("button", { name: "Copy image" })
		expect(button).toContainElement(view.getByRole("status", { name: "Preparing image" }))
		expect(button.querySelector(".diagram-image-spinner")).not.toBeNull()
		expect(button).toBeDisabled()
		expect(view.container.querySelector(".diagram-image-notice")).toBeNull()
		expect(button).toHaveAttribute("aria-busy", "true")
		await act(async () => frames.shift()!(0))
		expect(mocks.render).not.toHaveBeenCalled()
		await act(async () => frames.shift()!(16))
		expect(mocks.snapshot).toHaveBeenCalledWith([], [], true)
		expect(mocks.render).toHaveBeenCalledTimes(1)
		await expect(mocks.write.mock.calls[0][0]).resolves.toBe(await image)
		await act(async () => finish())
		expect(button).toContainElement(view.getByRole("status", { name: "Diagram image copied" }))
		expect(button.querySelector(".diagram-image-copied")).not.toBeNull()
		expect(button.querySelector(".diagram-image-spinner")).toBeNull()
		expect(button).toBeEnabled()
		expect(view.container.querySelector(".diagram-image-notice")).toBeNull()
		expect(view.queryByRole("button", { name: "Dismiss image notification" })).toBeNull()
		act(() => vi.advanceTimersByTime(2999))
		expect(view.getByRole("status", { name: "Diagram image copied" })).toBeInTheDocument()
		act(() => vi.advanceTimersByTime(1))
		expect(view.queryByRole("status")).toBeNull()
		expect(button.querySelector(".lucide-copy")).not.toBeNull()
		view.unmount()
	})

	it("cancels the previous success timeout when copying again and cleans up on unmount", async () => {
		vi.useFakeTimers()
		mocks.render.mockResolvedValue(new Blob(["png"], { type: "image/png" }))
		mocks.write.mockResolvedValue(undefined)
		const view = render(<CopyDiagramImage disabled={false} labels filename="checkout-v1" />)
		const button = view.getByRole("button", { name: "Copy image" })
		await act(async () => fireEvent.click(button))
		await paintSpinner()
		act(() => vi.advanceTimersByTime(2000))
		let finish!: () => void
		mocks.write.mockReturnValue(
			new Promise<void>((resolve) => {
				finish = resolve
			}),
		)
		fireEvent.click(button)
		await paintSpinner()
		act(() => vi.advanceTimersByTime(1000))
		expect(view.getByRole("status", { name: "Preparing image" })).toBeInTheDocument()
		await act(async () => finish())
		act(() => vi.advanceTimersByTime(2999))
		expect(view.getByRole("status", { name: "Diagram image copied" })).toBeInTheDocument()
		view.unmount()
		expect(vi.getTimerCount()).toBe(0)
	})

	it("retains a generated PNG for explicit download when clipboard access is denied", async () => {
		const blob = new Blob(["png"], { type: "image/png" })
		mocks.render.mockResolvedValue(blob)
		mocks.write.mockRejectedValue(new Error("Permission denied"))
		const view = render(<CopyDiagramImage disabled={false} labels={false} filename="checkout-v2" />)
		fireEvent.click(view.getByRole("button", { name: "Copy image" }))
		await paintSpinner()
		const download = await view.findByRole("link", { name: "Download PNG" })
		expect(view.getByRole("alert")).toHaveTextContent("Permission denied")
		expect(download).toHaveAttribute("href", "blob:diagram-image")
		expect(download).toHaveAttribute("download", "checkout-v2.png")
		expect(mocks.createUrl).toHaveBeenCalledWith(blob)
		fireEvent.click(view.getByRole("button", { name: "Dismiss image notification" }))
		expect(mocks.revoke).toHaveBeenCalledWith("blob:diagram-image")
		view.unmount()
	})

	it("reports rendering failure rather than offering a nonexistent download", async () => {
		mocks.render.mockRejectedValue(new Error("Image too large"))
		mocks.write.mockRejectedValue(new Error("Clipboard failed"))
		const view = render(<CopyDiagramImage disabled={false} labels={false} filename="checkout-v1" />)
		fireEvent.click(view.getByRole("button", { name: "Copy image" }))
		await paintSpinner()
		expect(await view.findByRole("alert")).toHaveTextContent("Image too large")
		expect(view.queryByRole("link")).toBeNull()
		expect(mocks.createUrl).not.toHaveBeenCalled()
		view.unmount()
	})

	it("does not start image generation if unmounted before the spinner paints", async () => {
		mocks.write.mockImplementation((image: Promise<Blob>) => image.then(() => undefined))
		const view = render(<CopyDiagramImage disabled={false} labels filename="checkout-v1" />)
		fireEvent.click(view.getByRole("button", { name: "Copy image" }))
		view.unmount()
		await paintSpinner()
		expect(mocks.snapshot).not.toHaveBeenCalled()
		expect(mocks.render).not.toHaveBeenCalled()
	})

	it("disables export while layout is unavailable and aborts its render on unmount", async () => {
		mocks.render.mockImplementation(
			(_snapshot, _style, signal: AbortSignal) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("Cancelled")))
				}),
		)
		mocks.write.mockImplementation((image: Promise<Blob>) => image.then(() => undefined))
		const view = render(<CopyDiagramImage disabled labels={false} filename="checkout-v1" />)
		fireEvent.click(view.getByRole("button", { name: "Copy image" }))
		expect(mocks.render).not.toHaveBeenCalled()
		view.rerender(<CopyDiagramImage disabled={false} labels={false} filename="checkout-v1" />)
		fireEvent.click(view.getByRole("button", { name: "Copy image" }))
		await paintSpinner()
		const signal = mocks.render.mock.calls[0][2] as AbortSignal
		view.unmount()
		await waitFor(() => expect(signal.aborted).toBe(true))
	})
})
