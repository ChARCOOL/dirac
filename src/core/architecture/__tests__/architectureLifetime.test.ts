import { strict as assert } from "node:assert"
import { randomUUID } from "node:crypto"
import sinon from "sinon"
import { architectureTaskLifetime, invalidateArchitectureTask } from "../architectureLifetime"

describe("Optional architecture task lifetime", () => {
	it("does not allocate a lifetime or deletion tombstone for an unused board", () => {
		const directory = randomUUID()
		const constructor = sinon.stub(globalThis, "AbortController").throws(new Error("Unexpected allocation"))
		try {
			invalidateArchitectureTask(directory)
			assert.equal(constructor.callCount, 0)
		} finally {
			constructor.restore()
		}
		assert.equal(architectureTaskLifetime(directory).signal.aborted, false)
	})

	it("retains invalidation for active and future writers of an existing board", () => {
		const directory = randomUUID()
		const controller = architectureTaskLifetime(directory)
		invalidateArchitectureTask(directory)
		assert.equal(controller.signal.aborted, true)
		assert.match(controller.signal.reason.message, /owning task was deleted/)
		assert.equal(architectureTaskLifetime(directory), controller)
	})
})
