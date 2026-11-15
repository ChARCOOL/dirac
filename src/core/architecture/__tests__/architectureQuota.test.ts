import { expect } from "chai"
import path from "path"
import sinon from "sinon"
import * as files from "../architectureFiles"
import { reserveArchitectureStorage } from "../architectureQuota"
import { ARCHITECTURE_LIMITS } from "../limits"

async function rejected(promise: Promise<unknown>, message: string): Promise<void> {
	try {
		await promise
		expect.fail("Expected quota rejection")
	} catch (error) {
		expect((error as Error).message).to.include(message)
	}
}

describe("architecture storage quota admission", () => {
	afterEach(() => sinon.restore())
	const current = () => undefined
	const root = path.resolve("quota-fixture")

	it("reserves bytes across concurrent diagram writes and releases failed reservations", async () => {
		sinon.stub(files, "measureArchitectureStorage").resolves(new Map())
		const release = await reserveArchitectureStorage(
			root,
			path.join(root, "a/v1.json"),
			ARCHITECTURE_LIMITS.maxTaskStorageBytes,
			current,
		)
		try {
			await rejected(reserveArchitectureStorage(root, path.join(root, "b/v1.json"), 1, current), "task limit")
		} finally {
			release()
		}
		const next = await reserveArchitectureStorage(root, path.join(root, "b/v1.json"), 1, current)
		next()
	})

	it("counts each admitted name and task version without truncating the inventory", async () => {
		const sizes = new Map(
			Array.from({ length: ARCHITECTURE_LIMITS.maxDiagramNamesPerTask }, (_, i) => [path.join(root, `n${i}/v1.json`), 1]),
		)
		const measure = sinon.stub(files, "measureArchitectureStorage").resolves(sizes)
		await rejected(reserveArchitectureStorage(root, path.join(root, "extra/v1.json"), 1, current), "diagram count limit")
		const versions = new Map(
			Array.from({ length: ARCHITECTURE_LIMITS.maxVersionsPerTask }, (_, i) => [
				path.join(root, `n${Math.floor(i / 1000)}/v${(i % 1000) + 1}.json`),
				1,
			]),
		)
		measure.resolves(versions)
		await rejected(reserveArchitectureStorage(root, path.join(root, "last/v1.json"), 1, current), "task version limit")
	})

	it("accounts for sidecar replacement rather than counting old and new bytes twice", async () => {
		const file = path.join(root, "a/v1.review.json")
		sinon.stub(files, "measureArchitectureStorage").resolves(new Map([[file, ARCHITECTURE_LIMITS.maxTaskStorageBytes]]))
		const release = await reserveArchitectureStorage(root, file, 100, current)
		release()
	})
})
