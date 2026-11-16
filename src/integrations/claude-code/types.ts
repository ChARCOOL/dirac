import type { Anthropic } from "@anthropic-ai/sdk"

type InitMessage = {
	type: "system"
	subtype: "init"
	session_id: string
	tools: string[]
	apiKeySource: "none" | "/login managed key" | string
}

type AssistantMessage = {
	type: "assistant"
	message: Anthropic.Messages.Message
	session_id: string
}

type ErrorMessage = {
	type: "error"
}

export type ResultMessage = {
	type: "result"
	subtype: "success" | "error_max_turns"
	total_cost_usd: number
	usage?: Partial<Anthropic.Messages.Usage>
	is_error: boolean
	duration_ms: number
	duration_api_ms: number
	num_turns: number
	result?: string
	session_id: string
	stop_reason?: string | null
	terminal_reason?: string
	api_error_status?: number | null
	safety_stops?: number
}

export type ClaudeCodeMessage = InitMessage | AssistantMessage | ErrorMessage | ResultMessage
