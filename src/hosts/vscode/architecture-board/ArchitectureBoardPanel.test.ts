import { strict as assert } from "node:assert"
import sinon from "sinon"
import proxyquire from "proxyquire"
import type { ArchitecturePanelOptions } from "@shared/architecture/panel"

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
function fixture() {
	const access = sinon.stub().resolves()
	const executeCommand = sinon.stub().resolves()
	const commandDispose = sinon.stub()
	const registerCommand = sinon.stub().returns({ dispose: commandDispose })
	const update = sinon.stub().resolves()
	const getConfiguration = sinon.stub().returns({ get: () => "paper", update })
	const listenerDispose = sinon.stub()
	const warn = sinon.stub()
	let close!: () => void
	let receive!: (message: unknown) => void
	const webview = {
		postMessage: sinon.stub().resolves(true),
		asWebviewUri: (uri: string) => `webview:${uri}`,
		cspSource: "vscode-webview:",
		html: "",
		onDidReceiveMessage: (callback: typeof receive) => {
			receive = callback
			return { dispose: listenerDispose }
		},
	}
	const panel = {
		webview,
		active: true,
		reveal: sinon.stub(),
		dispose: sinon.stub().callsFake(() => close?.()),
		onDidDispose: (callback: () => void) => {
			close = callback
			return { dispose: listenerDispose }
		},
	}
	const createWebviewPanel = sinon.stub().returns(panel)
	const vscode = {
		commands: { executeCommand, registerCommand },
		workspace: { getConfiguration, onDidChangeConfiguration: sinon.stub().returns({ dispose: listenerDispose }) },
		ConfigurationTarget: { Global: 1, Workspace: 2 },
		window: { createWebviewPanel },
		ViewColumn: { Active: 1 },
		Uri: { file: (path: string) => path, joinPath: (root: string, file: string) => `${root}/${file}` },
		"@noCallThru": true,
	}
	const { ArchitectureBoardZenMode } = proxyquire("./ArchitectureBoardZenMode", {
		vscode,
	}) as typeof import("./ArchitectureBoardZenMode")
	const zen = new ArchitectureBoardZenMode()
	const module = proxyquire("./ArchitectureBoardPanel", {
		"node:fs/promises": { access, "@noCallThru": true },
		"@shared/services/Logger": { Logger: { warn }, "@noCallThru": true },
		"@hosts/host-provider": { HostProvider: { get: () => ({ extensionFsPath: "/extension" }) }, "@noCallThru": true },
		"./ArchitectureBoardZenMode": { architectureBoardZenMode: zen, "@noCallThru": true },
		"./ArchitectureBoardStylePreference": {
			ARCHITECTURE_BOARD_STYLE_SETTING: "dirac.architectureBoard.style",
			readArchitectureBoardStyle: () => "paper",
			saveArchitectureBoardStyle: sinon.stub().resolves(),
			"@noCallThru": true,
		},
		vscode,
	}) as typeof import("./ArchitectureBoardPanel")
	return {
		module,
		panel,
		access,
		executeCommand,
		registerCommand,
		commandDispose,
		update,
		getConfiguration,
		createWebviewPanel,
		listenerDispose,
		zen,
		warn,
		send: (message: unknown) => receive(message),
	}
}
const options = (): ArchitecturePanelOptions => ({ taskId: "owner", onMessage: sinon.stub().resolves(), onDispose: sinon.stub() })
const enter = (f: ReturnType<typeof fixture>) => f.send({ type: "architecture_board_view", action: "enter_zen" })

describe("VS Code architecture panel", () => {
	it("preflights separate assets without opening a panel or entering fullscreen", async () => {
		const f = fixture()
		await f.module.prepareArchitectureBoard()
		assert.deepEqual(
			f.access.args.map((args) => args[0]),
			[
				"/extension/webview-ui/build/architecture-board/board.js",
				"/extension/webview-ui/build/architecture-board/board.css",
			],
		)
		sinon.assert.notCalled(f.createWebviewPanel)
		sinon.assert.notCalled(f.getConfiguration)
		f.access.rejects(new Error("asset missing"))
		await assert.rejects(f.module.prepareArchitectureBoard(), /missing/)
	})
	it("uses restricted roots/CSP, escapes identity, and retains the same webview", async () => {
		const f = fixture()
		const owner = { ...options(), taskId: 'owner"<>' }
		const board = await f.module.createArchitectureBoardPanel(owner)
		assert.deepEqual(f.createWebviewPanel.firstCall.args[3].localResourceRoots, [
			"/extension/webview-ui/build/architecture-board",
		])
		assert.equal(f.createWebviewPanel.firstCall.args[3].retainContextWhenHidden, true)
		assert.match(f.panel.webview.html, /default-src 'none'/)
		assert.match(f.panel.webview.html, /script-src 'nonce-/)
		assert.match(f.panel.webview.html, /owner&#34;&#60;&#62;/)
		assert.match(f.panel.webview.html, /data-native-zen-mode="true"/)
		assert.doesNotMatch(f.panel.webview.html, /assets\/index.js/)
		f.send({ type: "grpc_request" })
		sinon.assert.calledOnce(owner.onMessage as sinon.SinonStub)
		await board.refresh()
		f.panel.webview.postMessage.resolves(false)
		await assert.rejects(board.refresh(), /not delivered/)
		board.dispose()
		sinon.assert.calledOnce(owner.onDispose as sinon.SinonStub)
		assert.equal(f.listenerDispose.callCount, 3)
	})
	it("never changes window mode on open or reveal and only enters on an explicit request", async () => {
		const f = fixture()
		const board = await f.module.createArchitectureBoardPanel(options())
		const html = f.panel.webview.html
		board.reveal()
		board.reveal()
		await settle()
		sinon.assert.notCalled(f.executeCommand)
		sinon.assert.notCalled(f.update)
		assert.equal(f.zen.isActive, false)
		enter(f)
		enter(f)
		await settle()
		sinon.assert.calledOnceWithExactly(f.executeCommand, "workbench.action.toggleZenMode")
		assert.equal(f.zen.isActive, true)
		f.send({ type: "architecture_board_view", action: "ready" })
		await settle()
		sinon.assert.calledWith(f.panel.webview.postMessage, { type: "architecture_board_view_state", active: true })
		f.send({ type: "architecture_board_view", action: "exit_zen" })
		await settle()
		board.reveal()
		await settle()
		assert.equal(f.zen.isActive, false)
		assert.deepEqual(f.executeCommand.args, [["workbench.action.toggleZenMode"], ["workbench.action.exitZenMode"]])
		sinon.assert.notCalled(f.update)
		assert.equal(f.panel.webview.html, html)
		sinon.assert.calledOnce(f.createWebviewPanel)
	})
	it("synchronizes native Escape and releases its command with the last panel", async () => {
		const f = fixture()
		const board = await f.module.createArchitectureBoardPanel(options())
		const otherPanel = sinon.stub()
		const subscription = f.zen.subscribe(otherPanel)
		sinon.assert.calledOnce(f.registerCommand)
		assert.equal(f.registerCommand.firstCall.args[0], "dirac.architectureBoard.exitFullscreen")
		enter(f)
		await settle()
		await f.registerCommand.firstCall.args[1]()
		await settle()
		assert.equal(f.zen.isActive, false)
		sinon.assert.calledWithExactly(otherPanel, false)
		board.dispose()
		sinon.assert.notCalled(f.commandDispose)
		subscription.dispose()
		sinon.assert.calledOnce(f.commandDispose)
	})
	it("serializes explicit entry/exit and ignores disposed or inactive panels", async () => {
		const f = fixture()
		const board = await f.module.createArchitectureBoardPanel(options())
		enter(f)
		f.send({ type: "architecture_board_view", action: "exit_zen" })
		await settle()
		assert.equal(f.zen.isActive, false)
		assert.deepEqual(f.executeCommand.args, [["workbench.action.toggleZenMode"], ["workbench.action.exitZenMode"]])
		f.executeCommand.resetHistory()
		f.panel.active = false
		enter(f)
		await settle()
		sinon.assert.notCalled(f.executeCommand)
		f.panel.active = true
		enter(f)
		board.dispose()
		await settle()
		sinon.assert.notCalled(f.executeCommand)
	})
	it("reports native entry failures and permits retry without losing the board", async () => {
		const f = fixture()
		await f.module.createArchitectureBoardPanel(options())
		f.executeCommand.rejects(new Error("Native entry failed"))
		enter(f)
		await settle()
		assert.equal(f.zen.isActive, false)
		f.send({ type: "architecture_board_view", action: "ready" })
		await settle()
		assert.deepEqual(f.panel.webview.postMessage.lastCall.args[0], {
			type: "architecture_board_view_error",
			error: "Native entry failed",
		})
		f.executeCommand.resolves()
		enter(f)
		await settle()
		assert.equal(f.zen.isActive, true)
		sinon.assert.notCalled(f.panel.dispose)
	})
	it("rejects arbitrary commands and retains active state on a failed exit", async () => {
		const f = fixture()
		await f.module.createArchitectureBoardPanel(options())
		f.send({ type: "architecture_board_view", action: "workbench.action.closeWindow" })
		await settle()
		sinon.assert.notCalled(f.executeCommand)
		assert.match(f.panel.webview.postMessage.lastCall.args[0].error, /Unknown architecture board view action/)
		enter(f)
		await settle()
		f.executeCommand.rejects(new Error("Native exit failed"))
		f.send({ type: "architecture_board_view", action: "exit_zen" })
		await settle()
		assert.equal(f.zen.isActive, true)
		assert.deepEqual(f.panel.webview.postMessage.lastCall.args[0], {
			type: "architecture_board_view_error",
			error: "Native exit failed",
		})
	})
	it("contains notification rejection and cleans up all listeners even if one throws", async () => {
		const f = fixture()
		const owner = options()
		const board = await f.module.createArchitectureBoardPanel(owner)
		f.panel.webview.postMessage.rejects(new Error("transport closed"))
		f.send({ type: "architecture_board_view", action: "ready" })
		await settle()
		sinon.assert.calledWith(f.warn, "Architecture panel notification failed")
		f.listenerDispose.onFirstCall().throws(new Error("listener failed"))
		board.dispose()
		assert.equal(f.listenerDispose.callCount, 3)
		sinon.assert.calledOnce(owner.onDispose as sinon.SinonStub)
		sinon.assert.calledWith(f.warn, "Architecture panel listener cleanup failed")
	})
	it("reports failed construction without disposing an owning controller", async () => {
		const f = fixture()
		f.createWebviewPanel.throws(new Error("panel setup failed"))
		await assert.rejects(f.module.createArchitectureBoardPanel(options()), /setup failed/)
	})
})
