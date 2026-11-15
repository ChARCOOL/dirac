import type { ResolvedArchitectureIdentity } from "@shared/architecture"
import { Logger } from "@shared/services/Logger"

const listeners = new Set<(identity: ResolvedArchitectureIdentity) => Promise<void>>()

export function subscribeArchitecturePublications(
	listener: (identity: ResolvedArchitectureIdentity) => Promise<void>,
): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/** Publication is already committed. A failed/stalled viewer never delays or reverses it. */
export function notifyArchitecturePublication(identity: ResolvedArchitectureIdentity): void {
	for (const listener of listeners) {
		void Promise.resolve()
			.then(() => listener(identity))
			.catch((error) => {
				Logger.warn("Architecture panel synchronization failed; reopen the board to retry", error)
			})
	}
}
