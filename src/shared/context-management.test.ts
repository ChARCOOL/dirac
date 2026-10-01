import { expect } from "chai"
import { describe, it } from "mocha"
import { applyAutoCondenseAt, parseAutoCondenseAt, resolveAutoCondenseContextLimit } from "./context-management"

describe("auto-condense threshold", () => {
	it("reads a token count or a percent", () => {
		expect(parseAutoCondenseAt("500000")).to.deep.equal({ tokens: 500_000 })
		expect(parseAutoCondenseAt("60%")).to.deep.equal({ percent: 60 })
		expect(parseAutoCondenseAt(" 12.5% ")).to.deep.equal({ percent: 12.5 })
		for (const invalid of ["", "%", "0", "0%", "101%", "-5", "1.5", "abc"]) {
			expect(parseAutoCondenseAt(invalid)).to.equal(undefined)
		}
	})

	it("uses the provider's token limit, else the percent of the window, else the default", () => {
		expect(resolveAutoCondenseContextLimit({ openai: 400_000 }, 60, "openai", 1_000_000)).to.equal(400_000)
		expect(resolveAutoCondenseContextLimit({}, 60, "openai", 1_000_000)).to.equal(600_000)
		expect(resolveAutoCondenseContextLimit(undefined, 60, "openai", 256_000)).to.equal(153_600)
		expect(resolveAutoCondenseContextLimit(undefined, undefined, "openai", 1_000_000)).to.equal(272_000)
	})

	it("lets the last setting win for its provider only", () => {
		expect(applyAutoCondenseAt({ openai: 1, other: 2 }, "openai", { percent: 60 })).to.deep.equal({
			limits: { other: 2 },
			percent: 60,
		})
		expect(applyAutoCondenseAt({ other: 2 }, "openai", { tokens: 9 })).to.deep.equal({
			limits: { other: 2, openai: 9 },
			percent: undefined,
		})
	})
})
