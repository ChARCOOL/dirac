import { type ModelInfo, unbiasedDefaultModelId, unbiasedModels } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { DiracStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { formatOpenAiCompatibleUsage } from "../transform/openai-usage"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface UnbiasedHandlerOptions extends CommonApiHandlerOptions {
	unbiasedApiKey?: string
}

export class UnbiasedHandler implements ApiHandler {
	private client: OpenAI | undefined
	private abortController: AbortController | undefined

	constructor(private readonly options: UnbiasedHandlerOptions) { }

	private ensureClient(): OpenAI {
		if (!this.options.unbiasedApiKey) throw new Error("Unbiased API key is required. Sign in or enter a key in settings.")
		this.client ??= createOpenAIClient({
			baseURL: "https://api.unbiased.ai/v1",
			apiKey: this.options.unbiasedApiKey,
		})
		return this.client
	}

	async *createMessage(systemPrompt: string, messages: DiracStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const abortController = new AbortController()
		this.abortController = abortController
		try {
			yield* this.createMessageWithRetry(systemPrompt, messages, tools, abortController.signal)
		} finally {
			if (this.abortController === abortController) this.abortController = undefined
		}
	}

	@withRetry()
	private async *createMessageWithRetry(
		systemPrompt: string,
		messages: DiracStorageMessage[],
		tools: OpenAITool[] | undefined,
		signal: AbortSignal,
	): ApiStream {
		signal.throwIfAborted()
		const stream = await this.ensureClient().chat.completions.create(
			{
				model: unbiasedDefaultModelId,
				messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages, undefined, true)],
				stream: true,
				stream_options: { include_usage: true },
				...getOpenAIToolParams(tools),
			},
			{ signal },
		)
		const toolCallProcessor = new ToolCallProcessor()
		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) yield { type: "text", text: delta.content }
			if (delta?.tool_calls) yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			if (chunk.usage) yield formatOpenAiCompatibleUsage(chunk.usage, unbiasedModels.pareto)
		}
	}

	abort(): void {
		this.abortController?.abort()
	}

	getModel(): { id: string; info: ModelInfo } {
		// Other providers may leave their model ID in the shared mode field.
		// Unbiased accepts only pareto, regardless of the previous selection.
		return { id: unbiasedDefaultModelId, info: unbiasedModels.pareto }
	}
}
