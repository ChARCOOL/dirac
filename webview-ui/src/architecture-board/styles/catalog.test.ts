import { describe, expect, it } from "vitest"
import { boardStyles, resolveBoardStyle } from "./catalog"
import { boardGeometry } from "./boardGeometry"

describe("Board style catalog", () => {
	it("offers only Linen, Earth and Soft, with shared geometry", () => {
		expect(boardStyles.map((style) => style.id)).toEqual(["linen", "earth", "soft"])
		for (const style of boardStyles) expect(style.geometry).toBe(boardGeometry)
	})

	it.each([undefined, "auto", "current", "contour", "index", "draft", "paper", "neon", "unknown"])(
		"resolves %s to the appearance default without reviving removed styles",
		(id) => {
			expect(resolveBoardStyle(id, "light").id).toBe("linen")
			expect(resolveBoardStyle(id, "dark").id).toBe("earth")
		},
	)

	it.each(["linen", "earth", "soft"])("preserves explicit %s selection in both appearances", (id) => {
		expect(resolveBoardStyle(id, "light").id).toBe(id)
		expect(resolveBoardStyle(id, "dark").id).toBe(id)
	})
})
