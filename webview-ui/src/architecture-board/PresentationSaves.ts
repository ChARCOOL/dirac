import type { ArchitecturePresentation, ResolvedArchitectureIdentity } from "@shared/architecture"
import { BoardClient } from "./boardClient"

export interface PresentationSave {
	identity: ResolvedArchitectureIdentity
	presentation: ArchitecturePresentation
	status: "saving" | "saved" | "error"
	error?: string
}
export const presentationKey = (identity: ResolvedArchitectureIdentity) =>
	`${identity.taskId}/${identity.name}/${identity.version}`

/** Retains failed snapshots across view changes, coalesces gestures, and serializes each version's saves. */
export class PresentationSaves {
	private entries: PresentationSave[] = []
	private readonly running = new Set<string>()
	private readonly listeners = new Set<() => void>()
	getSnapshot = () => this.entries
	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
	get(identity: ResolvedArchitectureIdentity) {
		return this.entries.find((entry) => presentationKey(entry.identity) === presentationKey(identity))
	}
	private update(entry: PresentationSave) {
		this.entries = [...this.entries.filter((old) => presentationKey(old.identity) !== presentationKey(entry.identity)), entry]
		for (const listener of this.listeners) listener()
	}
	save(identity: ResolvedArchitectureIdentity, presentation: ArchitecturePresentation) {
		this.update({ identity, presentation, status: "saving" })
		void this.flush(identity)
	}
	retry(identity: ResolvedArchitectureIdentity) {
		const entry = this.get(identity)!
		this.save(identity, entry.presentation)
	}
	private async flush(identity: ResolvedArchitectureIdentity) {
		const key = presentationKey(identity)
		if (this.running.has(key)) return
		this.running.add(key)
		try {
			while (true) {
				const snapshot = this.get(identity)!
				try {
					await BoardClient.save(identity, snapshot.presentation)
				} catch (error) {
					this.update({
						...this.get(identity)!,
						status: "error",
						error: error instanceof Error ? error.message : String(error),
					})
					return
				}
				if (this.get(identity) !== snapshot) continue
				this.update({ ...snapshot, status: "saved" })
				return
			}
		} finally {
			this.running.delete(key)
		}
	}
}
