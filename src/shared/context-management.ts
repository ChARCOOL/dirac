export const DEFAULT_AUTO_CONDENSE_CONTEXT_LIMIT = 272_000
export const MAX_AUTO_CONDENSE_CONTEXT_LIMIT = 2_000_000_000

export type AutoCondenseContextLimits = Record<string, number>

export function isValidAutoCondenseContextLimit(value: number | undefined): value is number {
	return Number.isSafeInteger(value) && value! > 0 && value! <= MAX_AUTO_CONDENSE_CONTEXT_LIMIT
}

/** When compaction starts: `tokens`, or `percent` of the model's context window. */
export type AutoCondenseAt = { tokens: number } | { percent: number }

/** Reads `--auto-condense-at`: a token count, or a percent such as `60%`. */
export function parseAutoCondenseAt(value: string): AutoCondenseAt | undefined {
	const text = value.trim()
	if (text.endsWith("%")) {
		const percent = Number(text.slice(0, -1))
		return text.length > 1 && Number.isFinite(percent) && percent > 0 && percent <= 100 ? { percent } : undefined
	}
	const tokens = Number(text)
	return text !== "" && isValidAutoCondenseContextLimit(tokens) ? { tokens } : undefined
}

/**
 * The token count at which a provider's conversation compacts: its configured token limit,
 * else `percent` of the model's window, else the default.
 */
export function resolveAutoCondenseContextLimit(
	limits: AutoCondenseContextLimits | undefined,
	percent: number | undefined,
	providerId: string | undefined,
	contextWindow: number,
): number {
	const configuredLimit = providerId ? limits?.[providerId] : undefined
	if (isValidAutoCondenseContextLimit(configuredLimit)) return configuredLimit
	if (percent !== undefined && percent > 0 && percent <= 100) return Math.floor((contextWindow * percent) / 100)
	return DEFAULT_AUTO_CONDENSE_CONTEXT_LIMIT
}

/**
 * The settings for one `--auto-condense-at`: a token count replaces the provider's limit; a
 * percent clears it so the percent applies.
 */
export function applyAutoCondenseAt(
	limits: AutoCondenseContextLimits | undefined,
	providerId: string,
	at: AutoCondenseAt,
): { limits: AutoCondenseContextLimits; percent: number | undefined } {
	const { [providerId]: _replaced, ...others } = limits ?? {}
	return "tokens" in at
		? { limits: { ...others, [providerId]: at.tokens }, percent: undefined }
		: { limits: others, percent: at.percent }
}

export function getAutoCondenseContextLimit(
	limits: AutoCondenseContextLimits | undefined,
	providerId: string | undefined,
): number {
	const configuredLimit = providerId ? limits?.[providerId] : undefined
	return isValidAutoCondenseContextLimit(configuredLimit) ? configuredLimit : DEFAULT_AUTO_CONDENSE_CONTEXT_LIMIT
}
