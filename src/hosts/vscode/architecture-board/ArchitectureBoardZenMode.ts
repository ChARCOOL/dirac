import * as vscode from "vscode"

/**
 * Zen Mode belongs to the VS Code window, not a single board or diagram version.
 * Only successful board-requested transitions update this state. VS Code exposes
 * no public Zen Mode state/event API; external workbench toggles are not observed.
 */
export class ArchitectureBoardZenMode {
	private active = false
	private pending: Promise<void> = Promise.resolve()
	private readonly listeners = new Set<(active: boolean) => void>()
	private exitCommand?: vscode.Disposable

	get isActive(): boolean {
		return this.active
	}

	subscribe(listener: (active: boolean) => void): vscode.Disposable {
		// Native Escape Escape can run while focus is in the editor chrome, outside the webview.
		// Share its exit path with the board button so every subscribed panel receives the state.
		this.exitCommand ??= vscode.commands.registerCommand("dirac.architectureBoard.exitFullscreen", () =>
			this.setActive(false, () => this.listeners.size > 0),
		)
		this.listeners.add(listener)
		return {
			dispose: () => {
				this.listeners.delete(listener)
				if (!this.listeners.size) {
					this.exitCommand?.dispose()
					this.exitCommand = undefined
				}
			},
		}
	}

	setActive(active: boolean, isCurrent: () => boolean): Promise<void> {
		const operation = this.pending.then(async () => {
			if (!isCurrent()) return
			if (active) {
				if (this.active) return
				await vscode.commands.executeCommand("workbench.action.toggleZenMode")
			} else {
				// Native exit is safe even when Zen Mode was already dismissed externally.
				await vscode.commands.executeCommand("workbench.action.exitZenMode")
			}
			this.active = active
			for (const listener of this.listeners) listener(active)
		})
		// Keep subsequent requests usable after failure; the caller receives/reports the rejection.
		this.pending = operation.then(
			() => undefined,
			() => undefined,
		)
		return operation
	}
}

export const architectureBoardZenMode = new ArchitectureBoardZenMode()
