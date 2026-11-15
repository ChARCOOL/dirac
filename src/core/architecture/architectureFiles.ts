import { constants } from "fs"
import fs from "fs/promises"
import path from "path"
import { ARCHITECTURE_LIMITS } from "./limits"

export function isMissingFile(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT"
}

export async function assertArchitectureDirectory(directory: string): Promise<void> {
	const info = await fs.lstat(directory)
	if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Architecture storage requires a real directory")
}

/** Never recursively create a task: a late mkdir must fail after task deletion. */
export async function createArchitectureDirectory(directory: string, assertCurrent: () => void): Promise<void> {
	assertCurrent()
	try {
		await fs.mkdir(directory)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
	}
	assertCurrent()
	await assertArchitectureDirectory(directory)
}

/** Bounded reads also reject symlinks and non-regular files. */
export async function readArchitectureFile(file: string, maxBytes: number): Promise<string> {
	const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
	try {
		if (!(await handle.stat()).isFile()) throw new Error("Architecture content must be a regular file")
		const buffer = Buffer.alloc(maxBytes + 1)
		let offset = 0
		while (offset < buffer.length) {
			const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
			if (bytesRead === 0) return buffer.subarray(0, offset).toString("utf8")
			offset += bytesRead
		}
		throw new Error(`Architecture file exceeds the ${maxBytes}-byte limit`)
	} finally {
		await handle.close()
	}
}

/** Streaming inventory prevents an externally enlarged directory from allocating an unbounded array. */
export async function readArchitectureEntries(directory: string): Promise<import("fs").Dirent[]> {
	try {
		await assertArchitectureDirectory(directory)
		const result: import("fs").Dirent[] = []
		for await (const entry of await fs.opendir(directory)) {
			if (result.length >= ARCHITECTURE_LIMITS.maxInventoryEntries) {
				throw new Error("Architecture inventory exceeds the entry limit")
			}
			result.push(entry)
		}
		return result.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
	} catch (error) {
		if (isMissingFile(error)) return []
		throw error
	}
}

export async function readArchitectureVersions(directory: string): Promise<number[]> {
	const versions: number[] = []
	for (const entry of await readArchitectureEntries(directory)) {
		const match = /^v([1-9]\d*)\.json$/.exec(entry.name)
		if (!match) continue
		const version = Number(match[1])
		if (!Number.isSafeInteger(version) || version > ARCHITECTURE_LIMITS.maxVersionsPerDiagram) {
			throw new Error("Architecture version inventory exceeds the version limit")
		}
		if (!entry.isFile()) throw new Error(`Architecture semantic version ${entry.name} is not a regular file`)
		versions.push(version)
	}
	return versions.sort((a, b) => a - b)
}

/** Count bytes without parsing sidecars; corruption there cannot block semantic reads. */
export async function measureArchitectureStorage(root: string): Promise<Map<string, number>> {
	const sizes = new Map<string, number>()
	let entries = 0
	const visit = async (directory: string, depth: number): Promise<void> => {
		for (const entry of await readArchitectureEntries(directory)) {
			if (++entries > ARCHITECTURE_LIMITS.maxInventoryEntries)
				throw new Error("Architecture inventory exceeds the entry limit")
			const file = path.join(directory, entry.name)
			if (entry.isDirectory() && depth === 0) {
				await visit(file, 1)
				continue
			}
			if (!entry.isFile()) throw new Error("Architecture inventory contains an unsupported filesystem entry")
			try {
				sizes.set(file, (await fs.lstat(file)).size)
			} catch (error) {
				// Atomic-write temporary files can disappear while a different diagram is publishing.
				if (!isMissingFile(error) || !entry.name.includes(".tmp.")) throw error
			}
		}
	}
	await visit(root, 0)
	return sizes
}
