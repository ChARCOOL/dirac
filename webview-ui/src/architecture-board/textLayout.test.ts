import { describe, expect, it } from "vitest"
import { fitText, nodeTextRegions, sizeNodeForText, TITLE_LINE_HEIGHT } from "./textLayout"
import { boardNodeSizes } from "./styles/boardGeometry"
import type { NodeKind } from "@shared/architecture"

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const measure = (text: string) => Array.from(graphemes.segment(text)).length * 10

const labels = [
	"CheckoutSession",
	"Dirac harness",
	"POST /api/v1/organizations/very-long-workspace-id/checkout",
	"Payment pending · initial",
	"x".repeat(256),
	"订单付款确认已完成".repeat(12),
	"تأكيد الدفع للطلب الجديد".repeat(8),
	"👩🏽‍💻e\u0301🇮🇳".repeat(30),
	"First line\n\nThird line\nFourth line\nFifth line",
]

describe("Bounded measured title fitting", () => {
	it("prefers complete words even when the first line is short", () => {
		expect(fitText("Dirac harness", 100, 3, measure)).toEqual({ lines: ["Dirac", "harness"], truncated: false })
	})

	it("prefers camel-case and separator boundaries", () => {
		expect(fitText("CheckoutSession", 100, 2, measure)).toEqual({ lines: ["Checkout", "Session"], truncated: false })
		expect(fitText("src/core/task", 100, 2, measure)).toEqual({ lines: ["src/core/", "task"], truncated: false })
	})

	it("measures ellipsis as part of the last line", () => {
		expect(fitText("abcdefghi", 40, 1, measure)).toEqual({ lines: ["abc…"], truncated: true })
		expect(fitText("abcd", 40, 1, measure)).toEqual({ lines: ["abcd"], truncated: false })
		expect(fitText("abc", 5, 1, measure)).toEqual({ lines: [""], truncated: true })
	})

	it("preserves explicit line breaks and reports omitted lines", () => {
		expect(fitText("one\r\ntwo\nthree", 100, 2, measure)).toEqual({ lines: ["one", "two…"], truncated: true })
		expect(fitText("one\n\nthree", 100, 3, measure)).toEqual({ lines: ["one", "", "three"], truncated: false })
	})

	it("never cuts a grapheme sequence", () => {
		expect(fitText("👩🏽‍💻👩🏽‍💻👩🏽‍💻", 20, 1, measure)).toEqual({ lines: ["👩🏽‍💻…"], truncated: true })
		expect(fitText("e\u0301e\u0301e\u0301", 20, 1, measure)).toEqual({ lines: ["e\u0301…"], truncated: true })
	})

	it.each(labels)("bounds every line and work for %s", (label) => {
		for (const width of [1, 10, 40, 100, 220]) {
			for (const maxLines of [1, 2, 4]) {
				let measurements = 0
				const fit = fitText(label, width, maxLines, (text) => {
					measurements++
					return measure(text)
				})
				expect(fit.lines.length).toBeLessThanOrEqual(maxLines)
				for (const line of fit.lines) expect(measure(line)).toBeLessThanOrEqual(width)
				if (fit.truncated && width >= 10) expect(fit.lines.at(-1)).toMatch(/…$/u)
				expect(measurements).toBeLessThan(100)
			}
		}
	})
})

describe("Shape-aware title budgets", () => {
	const kinds = Object.keys(boardNodeSizes) as Exclude<NodeKind, "group">[]
	it.each(kinds)("keeps %s fitting inside its shape, clear of its descriptor and proposal", (kind) => {
		for (const proposal of [false, true]) {
			for (const label of labels) {
				const base = boardNodeSizes[kind]
				const size = sizeNodeForText(kind, label, base, proposal, measure)
				expect(size.width).toBeGreaterThanOrEqual(base.width)
				expect(size.width).toBeLessThanOrEqual(Math.ceil(base.width * 1.4))
				expect(size.height).toBeLessThanOrEqual(Math.ceil(base.height * 1.4))
				const { title, descriptor } = nodeTextRegions(kind, size, proposal)
				expect(title.x).toBeGreaterThanOrEqual(0)
				expect(title.y).toBeGreaterThanOrEqual(descriptor!.y + descriptor!.height)
				expect(title.x + title.width).toBeLessThanOrEqual(size.width)
				expect(title.y + title.height).toBeLessThanOrEqual(size.height - (proposal ? 36 : 0))
				const maxLines = Math.min(4, Math.floor(title.height / TITLE_LINE_HEIGHT))
				const fit = fitText(label, title.width - 1, maxLines, measure)
				expect(fit.lines.length * TITLE_LINE_HEIGHT).toBeLessThanOrEqual(title.height)
				if (kind === "actor") {
					for (const x of [title.x, title.x + title.width]) {
						for (const y of [title.y, title.y + title.height]) {
							expect(Math.hypot(x - size.width / 2, y - size.height / 2)).toBeLessThan(size.width / 2)
						}
					}
				}
			}
		}
	})

	it("keeps short names at the minimum tier and expands before truncating", () => {
		const base = boardNodeSizes.state
		expect(sizeNodeForText("state", "Paid", base, false, measure)).toEqual(base)
		const expanded = sizeNodeForText("state", "OrderConfirmationReceiptForInternationalCheckout", base, false, measure)
		expect(expanded.width).toBeGreaterThan(base.width)
	})
})
