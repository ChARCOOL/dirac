import { strict as assert } from "node:assert"
import sinon from "sinon"
import { resolveArchitectureSelection } from "./resolveArchitectureSelection"

const diagram = { title: "Diagram", summary: "Summary", nodes: [], edges: [] }
const identity = { taskId: "owner", name: "tools" }
const snapshot = (version: number) => ({ name: identity.name, version, diagram })

describe("Architecture selection availability", () => {
	it("uses the resolved latest snapshot without an additional read", async () => {
		const fetchDiagram = sinon.stub().resolves(snapshot(3))
		const view = await resolveArchitectureSelection({ ...identity, mode: "latest" }, { fetchDiagram })
		assert.equal(view.latestVersion, 3)
		assert.equal(view.latestVersionError, undefined)
		assert.equal(view.panes[0].version, 3)
		sinon.assert.calledOnceWithExactly(fetchDiagram, "tools", undefined)
	})

	it("reports a newer readable version without replacing an exact snapshot", async () => {
		const fetchDiagram = sinon.stub().callsFake(async (_name: string, version?: number) => snapshot(version ?? 4))
		const selection = { ...identity, mode: "exact" as const, version: 1 }
		const view = await resolveArchitectureSelection(selection, { fetchDiagram })
		assert.deepEqual(view.selection, selection)
		assert.equal(view.latestVersion, 4)
		assert.equal(view.latestVersionError, undefined)
		assert.equal(view.panes[0].version, 1)
	})

	it("leaves the comparison order fixed while reporting latest availability", async () => {
		const fetchDiagram = sinon.stub().callsFake(async (_name: string, version?: number) => snapshot(version ?? 5))
		const selection = { ...identity, mode: "comparison" as const, startVersion: 3, endVersion: 1 }
		const view = await resolveArchitectureSelection(selection, { fetchDiagram })
		assert.deepEqual(view.selection, selection)
		assert.deepEqual(view.panes.map((pane) => pane.version), [3, 1])
		assert.equal(view.latestVersion, 5)
		assert.equal(view.latestVersionError, undefined)
	})

	for (const message of ["latest missing", "latest corrupt", "inventory unavailable"]) {
		it(`keeps valid exact versions readable when ${message}`, async () => {
			const fetchDiagram = sinon.stub().callsFake(async (_name: string, version?: number) => {
				if (version === undefined) throw new Error(message)
				return snapshot(version)
			})
			for (const selection of [
				{ ...identity, mode: "exact" as const, version: 1 },
				{ ...identity, mode: "comparison" as const, startVersion: 1, endVersion: 2 },
			]) {
				const view = await resolveArchitectureSelection(selection, { fetchDiagram })
				assert.equal(view.latestVersion, undefined)
				assert.equal(view.latestVersionError, message)
				assert.deepEqual(view.selection, selection)
				assert.equal(view.panes[0].version, 1)
			}
			await assert.rejects(resolveArchitectureSelection({ ...identity, mode: "latest" }, { fetchDiagram }), new RegExp(message))
		})
	}

	it("reports non-Error advisory failures as text", async () => {
		const fetchDiagram = sinon.stub().callsFake(async (_name: string, version?: number) => {
			if (version === undefined) throw "latest lookup failed"
			return snapshot(version)
		})
		const view = await resolveArchitectureSelection({ ...identity, mode: "exact", version: 1 }, { fetchDiagram })
		assert.equal(view.latestVersion, undefined)
		assert.equal(view.latestVersionError, "latest lookup failed")
		assert.equal(view.panes[0].version, 1)
	})

	it("does not hide a failed requested snapshot behind readable latest metadata", async () => {
		const fetchDiagram = sinon.stub().callsFake(async (_name: string, version?: number) => {
			if (version === 1) throw new Error("requested snapshot missing")
			return snapshot(4)
		})
		await assert.rejects(
			resolveArchitectureSelection({ ...identity, mode: "exact", version: 1 }, { fetchDiagram }),
			/requested snapshot missing/,
		)
	})
})
