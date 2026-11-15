import { strict as assert } from "node:assert"
import sinon from "sinon"
import { Controller } from "../index"
import * as boardFactory from "../architecture/createArchitectureBoardController"
import { setHostCapabilities } from "@hosts/host-capabilities"
import { Logger } from "@shared/services/Logger"

/** Exercise optional-feature lifecycle without constructing a task or extension. */
describe("Controller architecture isolation", () => {
	let controller: Controller
	let create: sinon.SinonStub
	let board: { dispose: sinon.SinonStub }
	let goalDispose: sinon.SinonStub
	let clearTask: sinon.SinonStub
	beforeEach(() => {
		controller = Object.create(Controller.prototype)
		board = { dispose: sinon.stub() }
		create = sinon.stub(boardFactory, "createArchitectureBoardController").returns(board as any)
		goalDispose = sinon.stub().resolves()
		clearTask = sinon.stub().resolves()
		Object.assign(controller, { goalController: { dispose: goalDispose }, taskController: { clearTask } })
		setHostCapabilities({ architectureViewer: { prepare: async () => {}, createPanel: sinon.stub() } })
	})
	afterEach(() => {
		sinon.restore()
		setHostCapabilities(undefined)
	})
	it("never constructs the optional feature for ordinary controller disposal", async () => {
		await controller.dispose()
		sinon.assert.notCalled(create)
		sinon.assert.calledOnce(goalDispose)
		sinon.assert.calledOnce(clearTask)
	})
	it("rejects headless access before loading or constructing the feature", async () => {
		setHostCapabilities({})
		await assert.rejects(controller.getArchitectureBoards(), /unavailable on this host/)
		sinon.assert.notCalled(create)
	})
	it("shares concurrent initialization and retries a localized initialization failure", async () => {
		create.onFirstCall().throws(new Error("feature module failed"))
		const first = controller.getArchitectureBoards()
		const concurrent = controller.getArchitectureBoards()
		await assert.rejects(first, /feature module failed/)
		await assert.rejects(concurrent, /feature module failed/)
		sinon.assert.calledOnce(create)
		assert.equal(await controller.getArchitectureBoards(), board)
		assert.equal(await controller.getArchitectureBoards(), board)
		sinon.assert.calledTwice(create)
	})
	it("does not construct an optional controller after owner disposal during loading", async () => {
		const loading = controller.getArchitectureBoards()
		const rejected = assert.rejects(loading, /disposed/)
		await controller.dispose()
		await rejected
		sinon.assert.notCalled(create)
	})
	it("logs board cleanup failure and still disposes normal chat and goals", async () => {
		const warn = sinon.stub(Logger, "warn")
		await controller.getArchitectureBoards()
		board.dispose.throws(new Error("panel disposal failed"))
		await controller.dispose()
		sinon.assert.calledWith(warn, "Architecture board cleanup failed")
		sinon.assert.calledOnce(goalDispose)
		sinon.assert.calledOnce(clearTask)
		await assert.rejects(controller.getArchitectureBoards(), /disposed/)
	})
})
