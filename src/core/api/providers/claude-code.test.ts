import { expect } from "chai"
import proxyquire from "proxyquire"

const baseResult = {
	type: "result",
	subtype: "success",
	is_error: false,
	total_cost_usd: 0,
	duration_ms: 1,
	duration_api_ms: 1,
	num_turns: 1,
	session_id: "s",
}

const assistantWith = (content: unknown[]) => ({ type: "assistant", message: { stop_reason: null, content } })

const handlerFor = (chunks: unknown[]) => {
	const { ClaudeCodeHandler } = proxyquire("./claude-code", {
		"@/integrations/claude-code/run": {
			runClaudeCode: async function* () {
				yield* chunks
			},
		},
	})
	return new ClaudeCodeHandler({ apiModelId: "claude-haiku-5-5" })
}

const drain = async (chunks: unknown[]) => {
	const out: unknown[] = []
	for await (const chunk of handlerFor(chunks).createMessage("system", [])) {
		out.push(chunk)
	}
	return out
}

describe("ClaudeCodeHandler result checks", () => {
	it("throws with the CLI's reason when the call failed", async () => {
		const failed = { ...baseResult, is_error: true, terminal_reason: "model_error", result: "overloaded" }
		let message = ""
		try {
			await drain([assistantWith([{ type: "text", text: "partial" }]), failed])
		} catch (error) {
			message = (error as Error).message
		}
		expect(message).to.include("failed call").and.include("terminal_reason=model_error").and.include("overloaded")
	})

	it("throws instead of ending the turn when the call returned no content", async () => {
		let message = ""
		try {
			await drain([
				assistantWith([{ type: "thinking", thinking: "" }]),
				{ ...baseResult, stop_reason: "refusal", safety_stops: 1 },
			])
		} catch (error) {
			message = (error as Error).message
		}
		expect(message).to.include("no content").and.include("stop_reason=refusal").and.include("safety_stops=1")
	})

	it("passes a normal result through with its usage", async () => {
		const out = await drain([assistantWith([{ type: "text", text: "ok" }]), { ...baseResult, usage: { output_tokens: 7 } }])
		expect(out.map((chunk) => (chunk as { type: string }).type)).to.deep.equal(["text", "usage"])
	})

	it("treats the one-turn cap as a normal end", async () => {
		const out = await drain([
			assistantWith([{ type: "text", text: "ok" }]),
			{ ...baseResult, subtype: "error_max_turns", is_error: true },
		])
		expect(out.map((chunk) => (chunk as { type: string }).type)).to.deep.equal(["text", "usage"])
	})
})
