import { askDiracToolResponse, condenseToolResponse, newRuleToolResponse } from "../prompts/commands"

// Builtin slash commands recognized by the parser.
export const SUPPORTED_DEFAULT_COMMANDS = ["smol", "compact", "newrule", "permissions", "askDirac", "reloadtools"]

// Regex patterns to extract content from different XML tags.
export const TAG_PATTERNS = [
	{ tag: "task", regex: /<task>([\s\S]*?)<\/task>/i },
	{ tag: "feedback", regex: /<feedback>([\s\S]*?)<\/feedback>/i },
	{ tag: "answer", regex: /<answer>([\s\S]*?)<\/answer>/i },
	{ tag: "user_message", regex: /<user_message>([\s\S]*?)<\/user_message>/i },
	{ tag: "steering_message", regex: /<steering_message>([\s\S]*?)<\/steering_message>/i },
]

// Regex to find slash commands anywhere in text (not just at the beginning).
// (^|\s) ensures the slash is at start or preceded by whitespace, avoiding
// false matches in URLs (http://example.com/compact) and file paths (foo/bar).
// Only ONE slash command per message is processed (first match found).
export const SLASH_COMMAND_IN_TEXT_REGEX = /(^|\s)\/([a-zA-Z0-9_.:@-]+)(?=\s|$)/

// Builds the replacement-content map for builtin commands (askDirac needs paths).
export function buildCommandReplacements(
	extensionPath: string | undefined,
	sourceDir: string,
	conversationCondensationAvailable = false,
): Record<string, string | Promise<string>> {
	return {
		smol: condenseToolResponse(conversationCondensationAvailable),
		compact: condenseToolResponse(conversationCondensationAvailable),
		newrule: newRuleToolResponse(),
		askDirac: askDiracToolResponse(extensionPath, sourceDir),
		reloadtools: "__RELOAD_TOOLS__",
	}
}
