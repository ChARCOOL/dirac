import type { OpenaiReasoningEffort } from "@shared/storage/types"

/** Request-body fields the OpenAI SDK's types do not cover. */
export interface QwenTemplateParams {
	chat_template_kwargs?: Record<string, unknown>
}

// Qwen 3.8+ templates accept only low|medium|xhigh and default to xhigh.
const QWEN_TEMPLATE_EFFORT: Record<Exclude<OpenaiReasoningEffort, "none">, "low" | "medium" | "xhigh"> = {
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "xhigh",
	xhigh: "xhigh",
	max: "xhigh",
}

const QWEN_TEMPLATE_MODELS = ["qwen3.8", "qwen3-8", "qwen3.9", "qwen3-9"]

/** Qwen templates ignore the top-level effort, so it rides in the template kwargs; other models get nothing. */
export function qwenTemplateParams(modelId: string, effort: OpenaiReasoningEffort): QwenTemplateParams {
	const id = modelId.toLowerCase()
	if (!QWEN_TEMPLATE_MODELS.some((fragment) => id.includes(fragment))) {
		return {}
	}
	return {
		chat_template_kwargs:
			effort === "none"
				? { enable_thinking: false, preserve_thinking: true }
				: { enable_thinking: true, reasoning_effort: QWEN_TEMPLATE_EFFORT[effort], preserve_thinking: true },
	}
}
