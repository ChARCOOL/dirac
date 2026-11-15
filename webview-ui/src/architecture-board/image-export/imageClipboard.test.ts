import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { writeImageToClipboard } from "./imageClipboard"

// Model only the constructor contract; no browser permission or image rendering mocks.
class PendingClipboardItem {
	constructor(readonly data: Record<string, Promise<Blob>>) {}
}

const write = vi.fn<(items: PendingClipboardItem[]) => Promise<void>>()

beforeEach(() => {
	write.mockReset().mockResolvedValue(undefined)
	vi.stubGlobal("navigator", { clipboard: { write } })
	vi.stubGlobal("ClipboardItem", PendingClipboardItem)
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("writeImageToClipboard", () => {
	it("writes immediately with the original PNG promise before image production finishes", async () => {
		let resolveImage!: (image: Blob) => void
		const image = new Promise<Blob>((resolve) => {
			resolveImage = resolve
		})
		let resolveWrite!: () => void
		const completion = new Promise<void>((resolve) => {
			resolveWrite = resolve
		})
		write.mockReturnValue(completion)

		const result = writeImageToClipboard(image)

		// These assertions deliberately precede any await or image resolution: activation must not be lost.
		expect(write).toHaveBeenCalledTimes(1)
		const items = write.mock.calls[0][0]
		expect(items).toHaveLength(1)
		expect(items[0]).toBeInstanceOf(PendingClipboardItem)
		expect(Object.keys(items[0].data)).toEqual(["image/png"])
		expect(items[0].data["image/png"]).toBe(image)
		expect(result).toBe(completion)

		const png = new Blob(["PNG"], { type: "image/png" })
		resolveImage(png)
		await expect(items[0].data["image/png"]).resolves.toBe(png)
		resolveWrite()
		await expect(result).resolves.toBeUndefined()
		expect(write).toHaveBeenCalledTimes(1)
	})

	it.each([
		{ name: "clipboard API", clipboard: undefined },
		{ name: "clipboard.write", clipboard: {} },
	])("rejects with download guidance when $name is unavailable", async ({ clipboard }) => {
		vi.stubGlobal("navigator", { clipboard })

		await expect(writeImageToClipboard(Promise.resolve(new Blob()))).rejects.toThrow(
			"This webview does not support copying images. Download the PNG instead.",
		)
		expect(write).not.toHaveBeenCalled()
	})

	it("rejects with download guidance when ClipboardItem is unavailable", async () => {
		vi.stubGlobal("ClipboardItem", undefined)

		await expect(writeImageToClipboard(Promise.resolve(new Blob()))).rejects.toThrow(
			"This webview does not support copying images. Download the PNG instead.",
		)
		expect(write).not.toHaveBeenCalled()
	})

	it("converts a synchronous ClipboardItem constructor error into a rejected promise", async () => {
		const error = new Error("Promise-valued clipboard items are unsupported")
		vi.stubGlobal(
			"ClipboardItem",
			class {
				constructor() {
					throw error
				}
			},
		)

		const result = writeImageToClipboard(Promise.resolve(new Blob()))

		await expect(result).rejects.toBe(error)
		expect(write).not.toHaveBeenCalled()
	})

	it("converts a synchronous clipboard.write error into a rejected promise", async () => {
		const error = new Error("Clipboard write blocked")
		write.mockImplementation(() => {
			throw error
		})

		const result = writeImageToClipboard(Promise.resolve(new Blob()))

		await expect(result).rejects.toBe(error)
		expect(write).toHaveBeenCalledTimes(1)
	})

	it("preserves an asynchronous clipboard rejection without retrying", async () => {
		const error = new Error("Clipboard permission denied")
		const rejected = Promise.reject(error)
		write.mockReturnValue(rejected)

		const result = writeImageToClipboard(Promise.resolve(new Blob()))

		expect(result).toBe(rejected)
		await expect(result).rejects.toBe(error)
		expect(write).toHaveBeenCalledTimes(1)
	})
})
