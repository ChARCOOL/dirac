import { atomicWriteFile } from "@core/storage/atomicWrite"
import type {
	ArchitectureDiagram,
	ArchitectureDiagramInventoryEntry,
	ResolvedArchitectureIdentity,
	ReviewMutation,
	ReviewState,
} from "@shared/architecture"
import path from "path"
import {
	assertArchitectureDirectory,
	createArchitectureDirectory,
	isMissingFile,
	readArchitectureEntries,
	readArchitectureFile,
	readArchitectureVersions,
} from "./architectureFiles"
import { runArchitectureOperation, serializeArchitectureWrite } from "./architectureOperations"
import { reserveArchitectureStorage } from "./architectureQuota"
import { ARCHITECTURE_LIMITS } from "./limits"
import { applyReviewMutation, validateReviewMutation, validateReviewState } from "./reviewValidation"
import { assertDiagramName, assertDiagramVersion, parseArchitectureDiagram } from "./validation"

/** The sole writer of semantic versions and review sidecars. Construction performs no board I/O. */
export class ArchitectureStorage {
	private readonly root: string

	constructor(
		private readonly taskId: string,
		private readonly taskDirectory: string,
	) {
		this.root = path.join(this.taskDirectory, "architecture")
	}

	async upsertDiagram(name: string, json: string): Promise<{ name: string; version: number }> {
		assertDiagramName(name)
		const diagram = parseArchitectureDiagram(json)
		const content = JSON.stringify(diagram)
		return this.run((assertCurrent) =>
			serializeArchitectureWrite(this.diagramDirectory(name), async () => {
				assertCurrent()
				await assertArchitectureDirectory(this.taskDirectory)
				await createArchitectureDirectory(this.root, assertCurrent)
				const directory = this.diagramDirectory(name)
				const versions = await readArchitectureVersions(directory)
				const version = (versions.at(-1) ?? 0) + 1
				if (version > ARCHITECTURE_LIMITS.maxVersionsPerDiagram)
					throw new Error("Architecture diagram has reached its version limit")
				await this.write(path.join(directory, `v${version}.json`), content, assertCurrent)
				return { name, version }
			}),
		)
	}

	async listDiagrams(): Promise<ArchitectureDiagramInventoryEntry[]> {
		return this.run(async (assertCurrent) => {
			await this.assertRoot()
			const result: ArchitectureDiagramInventoryEntry[] = []
			let totalVersions = 0
			for (const entry of await readArchitectureEntries(this.root)) {
				assertCurrent()
				if (!entry.isDirectory()) {
					if (entry.isSymbolicLink()) throw new Error("Architecture inventory contains a symbolic link")
					continue
				}
				assertDiagramName(entry.name)
				const versions = await readArchitectureVersions(this.diagramDirectory(entry.name))
				if (versions.length === 0) continue
				totalVersions += versions.length
				if (
					totalVersions > ARCHITECTURE_LIMITS.maxVersionsPerTask ||
					result.length >= ARCHITECTURE_LIMITS.maxDiagramNamesPerTask
				) {
					throw new Error("Architecture inventory exceeds task limits")
				}
				result.push({ name: entry.name, versions })
			}
			assertCurrent()
			return result
		})
	}

	async fetchDiagram(name: string, version?: number): Promise<{ name: string; version: number; diagram: ArchitectureDiagram }> {
		assertDiagramName(name)
		if (version !== undefined) assertDiagramVersion(version)
		return this.run(async (assertCurrent) => {
			const result = await this.readDiagram(name, version)
			assertCurrent()
			return result
		})
	}

	async readReview(identity: ResolvedArchitectureIdentity): Promise<ReviewState> {
		this.assertIdentity(identity)
		return this.run(async (assertCurrent) => {
			const { diagram } = await this.readDiagram(identity.name, identity.version)
			const review = await this.readSidecar(identity, diagram)
			assertCurrent()
			return review
		})
	}

	/** A caller timeout is not filesystem settlement. Explicit feedback snapshots wait for both. */
	async waitForPendingWrites(name: string): Promise<void> {
		assertDiagramName(name)
		await this.run((assertCurrent) => serializeArchitectureWrite(this.diagramDirectory(name), async () => assertCurrent()))
	}

	async mutateReview(input: ReviewMutation): Promise<ReviewState> {
		const mutation = validateReviewMutation(input)
		this.assertIdentity(mutation.identity)
		return this.run((assertCurrent) =>
			serializeArchitectureWrite(this.diagramDirectory(mutation.identity.name), async () => {
				assertCurrent()
				const { diagram } = await this.readDiagram(mutation.identity.name, mutation.identity.version)
				const review = await this.readSidecar(mutation.identity, diagram)
				const updated = applyReviewMutation(review, mutation, diagram)
				await this.write(this.reviewFile(mutation.identity), JSON.stringify(updated), assertCurrent)
				return updated
			}),
		)
	}

	private async readDiagram(
		name: string,
		requestedVersion?: number,
	): Promise<{ name: string; version: number; diagram: ArchitectureDiagram }> {
		await this.assertRoot()
		const directory = this.diagramDirectory(name)
		try {
			await assertArchitectureDirectory(directory)
		} catch (error) {
			if (isMissingFile(error)) throw new Error(`Architecture diagram ${name} does not exist`)
			throw error
		}
		const version = requestedVersion ?? (await readArchitectureVersions(directory)).at(-1)
		if (version === undefined) throw new Error(`Architecture diagram ${name} has no saved versions`)
		try {
			const json = await readArchitectureFile(path.join(directory, `v${version}.json`), ARCHITECTURE_LIMITS.maxDiagramBytes)
			return { name, version, diagram: parseArchitectureDiagram(json) }
		} catch (error) {
			if (isMissingFile(error)) throw new Error(`Architecture diagram ${name} version ${version} does not exist`)
			throw error
		}
	}

	private async readSidecar(identity: ResolvedArchitectureIdentity, diagram: ArchitectureDiagram): Promise<ReviewState> {
		let json: string
		try {
			json = await readArchitectureFile(this.reviewFile(identity), ARCHITECTURE_LIMITS.maxReviewBytes)
		} catch (error) {
			if (isMissingFile(error)) return { comments: [] }
			throw error
		}
		return validateReviewState(JSON.parse(json), diagram)
	}

	private async write(file: string, content: string, assertCurrent: () => void): Promise<void> {
		const release = await reserveArchitectureStorage(this.root, file, Buffer.byteLength(content), assertCurrent)
		try {
			assertCurrent()
			// Admit quota before creating a name, so rejected writes cannot accumulate empty directories.
			await createArchitectureDirectory(path.dirname(file), assertCurrent)
			// This helper creates only a temporary file, never directories. Deletion does not wait for it.
			await atomicWriteFile(file, content)
			assertCurrent()
		} finally {
			release()
		}
	}

	private async assertRoot(): Promise<void> {
		await assertArchitectureDirectory(this.taskDirectory)
		try {
			await assertArchitectureDirectory(this.root)
		} catch (error) {
			if (!isMissingFile(error)) throw error
		}
	}

	private assertIdentity(identity: ResolvedArchitectureIdentity): void {
		if (identity.taskId !== this.taskId) throw new Error("Architecture review belongs to a different task")
		assertDiagramName(identity.name)
		assertDiagramVersion(identity.version)
	}

	private diagramDirectory(name: string): string {
		return path.join(this.root, name)
	}

	private reviewFile(identity: ResolvedArchitectureIdentity): string {
		return path.join(this.diagramDirectory(identity.name), `v${identity.version}.review.json`)
	}

	private async run<T>(action: (assertCurrent: () => void) => Promise<T>): Promise<T> {
		try {
			return await runArchitectureOperation(this.taskDirectory, action)
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code) throw new Error(`Architecture storage operation failed (${code})`)
			throw error
		}
	}
}
