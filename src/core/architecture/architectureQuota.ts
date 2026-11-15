import path from "path"
import { measureArchitectureStorage } from "./architectureFiles"
import { serializeArchitectureWrite } from "./architectureOperations"
import { ARCHITECTURE_LIMITS } from "./limits"

const reservations = new Map<string, Map<string, number>>()

/** Only quota admission is task-wide; slow writes remain in their own diagram queues. */
export function reserveArchitectureStorage(
	root: string,
	file: string,
	bytes: number,
	assertCurrent: () => void,
): Promise<() => void> {
	return serializeArchitectureWrite(`${root}:quota`, async () => {
		assertCurrent()
		const sizes = await measureArchitectureStorage(root)
		assertCurrent()
		const pending = reservations.get(root) ?? new Map<string, number>()
		const projected = new Map(sizes)
		for (const [reservedFile, reservedBytes] of pending) {
			projected.set(reservedFile, Math.max(projected.get(reservedFile) ?? 0, reservedBytes))
		}
		projected.set(file, bytes)
		const total = [...projected.values()].reduce((sum, size) => sum + size, 0)
		if (total > ARCHITECTURE_LIMITS.maxTaskStorageBytes) {
			throw new Error(`Architecture storage exceeds the ${ARCHITECTURE_LIMITS.maxTaskStorageBytes}-byte task limit`)
		}
		if (projected.size > ARCHITECTURE_LIMITS.maxInventoryEntries)
			throw new Error("Architecture inventory exceeds the entry limit")
		const semanticFiles = [...projected.keys()].filter((name) => /^v[1-9]\d*\.json$/.test(path.basename(name)))
		if (semanticFiles.length > ARCHITECTURE_LIMITS.maxVersionsPerTask)
			throw new Error("Architecture storage exceeds the task version limit")
		const names = new Set(semanticFiles.map((name) => path.dirname(name)))
		if (names.size > ARCHITECTURE_LIMITS.maxDiagramNamesPerTask)
			throw new Error("Architecture storage exceeds the diagram count limit")
		pending.set(file, bytes)
		reservations.set(root, pending)
		return () => {
			pending.delete(file)
			if (pending.size === 0) reservations.delete(root)
		}
	})
}
