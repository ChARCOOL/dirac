import type { ArchitectureSelection } from "./index"
import type { ExtensionMessage } from "../ExtensionMessage"
import type { WebviewMessage } from "../WebviewMessage"

/** Window chrome actions stay in the host adapter; they never enter the task/RPC pipeline. */
export interface ArchitecturePanelViewRequest {
	type: "architecture_board_view"
	action: "enter_zen" | "exit_zen" | "ready"
}

export interface ArchitecturePanelViewState {
	type: "architecture_board_view_state"
	active: boolean
}

export interface ArchitecturePanelViewError {
	type: "architecture_board_view_error"
	error: string
}

/** Host-local user preference, not semantic diagram or task state. */
export interface ArchitecturePanelStyleRequest {
	type: "architecture_board_style"
	style: string
}
export interface ArchitecturePanelStyleState {
	type: "architecture_board_style_state"
	style: string
}
export interface ArchitecturePanelStyleError {
	type: "architecture_board_style_error"
	error: string
}

export interface ArchitecturePanel {
	reveal(): void
	refresh(): Promise<void>
	dispose(): void
}

export interface ArchitecturePanelOptions {
	taskId: string
	/** Stable diagram name for distinguishing independent editor tabs. */
	name?: string
	onMessage(message: WebviewMessage, post: (response: ExtensionMessage) => Promise<boolean>): Promise<void>
	onDispose(): void
}

/** Optional host boundary; construction and skill discovery perform no viewer I/O. */
export interface ArchitectureViewer {
	/** Reveal a validated selection through the host's owning board controller. */
	openSelection?(selection: ArchitectureSelection): Promise<void>
	prepare(): Promise<void>
	createPanel(options: ArchitecturePanelOptions): Promise<ArchitecturePanel>
	openCode?(
		absolutePath: string,
		line: number | undefined,
		symbol: string | undefined,
		assertCurrent: () => void,
	): Promise<void>
}
