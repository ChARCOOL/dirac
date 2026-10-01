import "should"
import sinon from "sinon"
import { afterEach, describe, it } from "mocha"
import { qwenTemplateParams } from "../model-presets"
import { OpenAiHandler } from "../openai"

const createAsyncIterable = (data: any[] = []) => ({
	[Symbol.asyncIterator]: async function* () {
		yield* data
	},
})

const captureRequest = async (options: Record<string, unknown>) => {
	const handler = new OpenAiHandler({ openAiApiKey: "test-key", openAiBaseUrl: "http://127.0.0.1:4000/v1", ...options } as any)
	const create = sinon.stub().resolves(createAsyncIterable())
	sinon.stub(handler as any, "ensureClient").returns({ chat: { completions: { create } } } as any)
	for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "hi" }] as any)) {
		// consume
	}
	return create.firstCall.args[0]
}

describe("qwenTemplateParams", () => {
	it("maps effort into the Qwen template kwargs", () => {
		qwenTemplateParams("qwen3.8:27b", "high").should.deepEqual({
			chat_template_kwargs: { enable_thinking: true, reasoning_effort: "xhigh", preserve_thinking: true },
		})
		qwenTemplateParams("Qwen3-9-32B", "minimal").should.deepEqual({
			chat_template_kwargs: { enable_thinking: true, reasoning_effort: "low", preserve_thinking: true },
		})
		qwenTemplateParams("qwen3.8:27b", "none").should.deepEqual({
			chat_template_kwargs: { enable_thinking: false, preserve_thinking: true },
		})
	})

	it("adds nothing for other models", () => {
		qwenTemplateParams("deepseek-v4.1-flash", "high").should.deepEqual({})
		qwenTemplateParams("qwen2.5-coder", "high").should.deepEqual({})
	})
})

describe("OpenAiHandler request body", () => {
	afterEach(() => sinon.restore())

	it("sends the Qwen template kwargs for Qwen 3.8+", async () => {
		const request = await captureRequest({ openAiModelId: "qwen3.8:27b", reasoningEffort: "medium" })
		request.should.have.property("chat_template_kwargs", {
			enable_thinking: true,
			reasoning_effort: "medium",
			preserve_thinking: true,
		})
	})

	it("sends no sampling of its own, so the server or proxy default applies", async () => {
		const request = await captureRequest({ openAiModelId: "deepseek-v4.1-flash" })
		;(request.temperature === undefined).should.be.true()
		request.should.not.have.properties(["top_p", "top_k", "chat_template_kwargs"])
	})

	it("sends a configured temperature", async () => {
		const request = await captureRequest({ openAiModelId: "deepseek-v4.1-flash", openAiModelInfo: { temperature: 0.2 } })
		request.should.have.property("temperature", 0.2)
	})
})
