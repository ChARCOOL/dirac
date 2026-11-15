import { strict as assert } from "node:assert"
import proxyquire from "proxyquire"
import sinon from "sinon"

describe("VS Code architecture code links", () => {
	const document = { uri: { fsPath: "/owned/source.ts" }, lineCount: 10 }
	const showTextDocument = sinon.stub()
	const executeCommand = sinon.stub()
	const openTextDocument = sinon.stub()
	const { openArchitectureCode: navigate } = proxyquire.noCallThru().load("./openArchitectureCode", {
		vscode: {
			Uri: { file: (path: string) => ({ fsPath: path }) },
			Range: class {
				constructor(
					public startLine: number,
					public startCharacter: number,
					public endLine: number,
					public endCharacter: number,
				) {}
			},
			ViewColumn: { Beside: 2 },
			workspace: { openTextDocument },
			window: { showTextDocument },
			commands: { executeCommand },
		},
	})
	const openArchitectureCode = (file: string, line?: number, symbol?: string) => navigate(file, line, symbol, () => {})
	beforeEach(() => {
		openTextDocument.reset()
		openTextDocument.resolves(document)
		showTextDocument.reset()
		showTextDocument.resolves()
		executeCommand.reset()
		executeCommand.resolves([])
	})
	it("opens an authorized file beside the board at an exact one-based line", async () => {
		await openArchitectureCode("/owned/source.ts", 4)
		assert.deepEqual(openTextDocument.firstCall.args, [{ fsPath: "/owned/source.ts" }])
		assert.equal(showTextDocument.firstCall.args[1].selection.startLine, 3)
		assert.equal(showTextDocument.firstCall.args[1].viewColumn, 2)
		assert.equal(executeCommand.callCount, 0)
	})
	it("resolves a qualified document symbol using only the fixed provider command", async () => {
		const range = { start: "symbol start" }
		executeCommand.resolves([
			{ name: "Task", selectionRange: {}, children: [{ name: "run", selectionRange: range, children: [] }] },
		])
		await openArchitectureCode("/owned/source.ts", undefined, "Task.run")
		assert.deepEqual(executeCommand.firstCall.args, ["vscode.executeDocumentSymbolProvider", document.uri])
		assert.equal(showTextDocument.firstCall.args[1].selection, range)
	})
	it("reports stale lines and missing/ambiguous symbols instead of navigating elsewhere", async () => {
		await assert.rejects(openArchitectureCode("/owned/source.ts", 11), /no longer exists/)
		await assert.rejects(openArchitectureCode("/owned/source.ts", undefined, "command:evil"), /missing or ambiguous/)
		executeCommand.resolves([
			{ name: "run", selectionRange: {}, children: [] },
			{ name: "run", selectionRange: {}, children: [] },
		])
		await assert.rejects(openArchitectureCode("/owned/source.ts", undefined, "run"), /ambiguous/)
		assert.equal(showTextDocument.callCount, 0)
	})
	it("rejects a late symbol-provider result after its owning request becomes stale", async () => {
		let current = true
		executeCommand.callsFake(async () => {
			current = false
			return [{ name: "Task", selectionRange: {}, children: [] }]
		})
		await assert.rejects(
			navigate("/owned/source.ts", undefined, "Task", () => {
				if (!current) throw new Error("stale navigation")
			}),
			/stale/,
		)
		assert.equal(showTextDocument.callCount, 0)
	})
})
