import fs from "node:fs/promises"
import path from "node:path"
import { randomBytes } from "node:crypto"
import * as vscode from "vscode"
import { HostProvider } from "@hosts/host-provider"
import type {
	ArchitecturePanel,
	ArchitecturePanelOptions,
	ArchitecturePanelViewRequest,
	ArchitecturePanelViewError,
	ArchitecturePanelViewState,
	ArchitecturePanelStyleRequest,
	ArchitecturePanelStyleState,
	ArchitecturePanelStyleError,
} from "@shared/architecture/panel"
import type { WebviewMessage } from "@shared/WebviewMessage"
import type { ExtensionMessage } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { architectureBoardZenMode } from "./ArchitectureBoardZenMode"
import {
	ARCHITECTURE_BOARD_STYLE_SETTING,
	readArchitectureBoardStyle,
	saveArchitectureBoardStyle,
} from "./ArchitectureBoardStylePreference"

const bundlePath = () => path.join(HostProvider.get().extensionFsPath, "webview-ui", "build", "architecture-board")

/** Validate delivered assets before opening a board or entering its input wait. */
export async function prepareArchitectureBoard(): Promise<void> {
	for (const asset of ["board.js", "board.css"]) {
		await fs.access(path.join(bundlePath(), asset))
	}
}

export async function createArchitectureBoardPanel(options: ArchitecturePanelOptions): Promise<ArchitecturePanel> {
	await prepareArchitectureBoard()
	const root = vscode.Uri.file(bundlePath())
	const panel = vscode.window.createWebviewPanel(
		"dirac.architectureBoard",
		options.name ? `Architecture: ${options.name}` : "Architecture board",
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [root],
		},
	)
	const disposables: vscode.Disposable[] = []
	let disposed = false
	let viewError: string | undefined
	const postNotification = (
		message:
			| ArchitecturePanelViewState
			| ArchitecturePanelViewError
			| ArchitecturePanelStyleState
			| ArchitecturePanelStyleError,
	) => {
		if (disposed) return
		void Promise.resolve()
			.then(() => panel.webview.postMessage(message))
			.catch((error) => {
				Logger.warn("Architecture panel notification failed", error)
			})
	}
	const disposeListeners = () => {
		for (const disposable of disposables.splice(0)) {
			try {
				disposable.dispose()
			} catch (error) {
				Logger.warn("Architecture panel listener cleanup failed", error)
			}
		}
	}
	const postViewState = () => {
		postNotification({
			type: "architecture_board_view_state",
			active: architectureBoardZenMode.isActive,
		} satisfies ArchitecturePanelViewState)
	}
	const reportViewError = (error: unknown) => {
		Logger.warn("Architecture panel view action failed", error)
		viewError = error instanceof Error ? error.message : String(error)
		postNotification({
			type: "architecture_board_view_error",
			error: viewError,
		} satisfies ArchitecturePanelViewError)
	}
	const postStyleState = () => {
		postNotification({
			type: "architecture_board_style_state",
			style: readArchitectureBoardStyle(),
		} satisfies ArchitecturePanelStyleState)
	}
	const reportStyleError = (error: unknown) => {
		Logger.warn("Architecture board style preference failed", error)
		postNotification({
			type: "architecture_board_style_error",
			error: error instanceof Error ? error.message : String(error),
		} satisfies ArchitecturePanelStyleError)
	}
	const changeView = async (action: ArchitecturePanelViewRequest["action"]) => {
		if (action === "ready") {
			postViewState()
			postStyleState()
			if (viewError) reportViewError(viewError)
			return
		}
		if (action !== "enter_zen" && action !== "exit_zen") throw new Error(`Unknown architecture board view action: ${action}`)
		await architectureBoardZenMode.setActive(action === "enter_zen", () => !disposed && panel.active)
		viewError = undefined
		postViewState()
	}
	try {
		disposables.push(architectureBoardZenMode.subscribe(postViewState))
		disposables.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(ARCHITECTURE_BOARD_STYLE_SETTING)) postStyleState()
			}),
		)
		const post = async (response: ExtensionMessage) => panel.webview.postMessage(response)
		disposables.push(
			panel.webview.onDidReceiveMessage(
				(message: WebviewMessage | ArchitecturePanelViewRequest | ArchitecturePanelStyleRequest) => {
					if (message.type === "architecture_board_style") {
						void saveArchitectureBoardStyle(message.style).then(postStyleState).catch(reportStyleError)
						return
					}
					if (message.type === "architecture_board_view") {
						void changeView(message.action).catch(reportViewError)
						return
					}
					void options
						.onMessage(message, post)
						.catch((error) => Logger.warn("Architecture panel transport failed", error))
				},
			),
		)
		disposables.push(
			panel.onDidDispose(() => {
				disposed = true
				disposeListeners()
				options.onDispose()
			}),
		)
		const nonce = randomBytes(18).toString("base64")
		const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(root, "board.js"))
		const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(root, "board.css"))
		// taskId is validated by the controller; escape regardless because this is an HTML boundary.
		const taskId = options.taskId.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
		const boardStyle = readArchitectureBoardStyle().replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
		panel.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; worker-src blob:; img-src data:; font-src data:;"><link rel="stylesheet" href="${style}"><title>Architecture board</title></head><body><main id="root" data-task-id="${taskId}" data-native-zen-mode="true" data-board-style="${boardStyle}"><h1>Architecture board</h1><p>Loading the architecture viewer. If it does not load, reopen this tab after rebuilding the extension. Ordinary chat remains available.</p></main><script nonce="${nonce}" type="module" src="${script}"></script></body></html>`
		return {
			reveal: () => panel.reveal(),
			refresh: async () => {
				if (!(await panel.webview.postMessage({ type: "architecture_board_changed", taskId: options.taskId }))) {
					throw new Error("Architecture panel update was not delivered; reopen the board")
				}
			},
			dispose: () => panel.dispose(),
		}
	} catch (error) {
		disposed = true
		disposeListeners()
		panel.dispose()
		throw error
	}
}
