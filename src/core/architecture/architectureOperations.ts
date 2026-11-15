import { architectureTaskLifetime } from "./architectureLifetime"
import { ARCHITECTURE_LIMITS } from "./limits"
export { invalidateArchitectureTask } from "./architectureLifetime"

// Board queues are independent of conversation locks and carry no disk state.
const queues = new Map<string, Promise<void>>()

/** Keep ordering until actual settlement, even if the caller's deadline has elapsed. */
export function serializeArchitectureWrite<T>(key: string, action: () => Promise<T>): Promise<T> {
	const result = (queues.get(key) ?? Promise.resolve()).then(action)
	const settled = result.then(
		() => undefined,
		() => undefined,
	)
	queues.set(key, settled)
	void settled.then(() => {
		if (queues.get(key) === settled) queues.delete(key)
	})
	return result
}

export async function runArchitectureOperation<T>(
	taskDirectory: string,
	action: (assertCurrent: () => void) => Promise<T>,
): Promise<T> {
	const signal = architectureTaskLifetime(taskDirectory).signal
	let expired = false
	const timeoutError = new Error(
		"Architecture operation timed out. An active filesystem write may still settle; list/fetch before retrying publication.",
	)
	const assertCurrent = () => {
		if (signal.aborted) throw signal.reason
		if (expired) throw timeoutError
	}
	assertCurrent()
	let timer: ReturnType<typeof setTimeout> | undefined
	let onDelete: () => void = () => undefined
	const interrupted = new Promise<never>((_, reject) => {
		onDelete = () => reject(signal.reason)
		signal.addEventListener("abort", onDelete, { once: true })
		timer = setTimeout(() => {
			expired = true
			reject(timeoutError)
		}, ARCHITECTURE_LIMITS.operationTimeoutMs)
	})
	try {
		return await Promise.race([action(assertCurrent), interrupted])
	} finally {
		clearTimeout(timer)
		signal.removeEventListener("abort", onDelete)
	}
}
