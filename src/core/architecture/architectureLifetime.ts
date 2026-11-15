// Dependency-free deletion boundary: importing this module performs no storage work.
const lifetimes = new Map<string, AbortController>()

export function architectureTaskLifetime(taskDirectory: string): AbortController {
	let controller = lifetimes.get(taskDirectory)
	if (!controller) {
		controller = new AbortController()
		lifetimes.set(taskDirectory, controller)
	}
	return controller
}

/** Deletion never waits for feature work or allocates state for an unused board. */
export function invalidateArchitectureTask(taskDirectory: string): void {
	// Retain existing tombstones so late/queued writers cannot revive a deleted task.
	lifetimes.get(taskDirectory)?.abort(new Error("Architecture storage is unavailable: the owning task was deleted"))
}
