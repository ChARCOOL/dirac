import * as vscode from "vscode"

export const ARCHITECTURE_BOARD_STYLE_SETTING = "dirac.architectureBoard.style"

export function readArchitectureBoardStyle(): string {
	return vscode.workspace.getConfiguration("dirac.architectureBoard").get<string>("style", "auto")
}

/** Persist only a style ID. CSS, paths and diagram content never cross this boundary. */
export async function saveArchitectureBoardStyle(style: string): Promise<void> {
	if (typeof style !== "string" || !/^[a-z][a-z0-9-]*$/.test(style)) throw new Error("Invalid architecture board style ID")
	await vscode.workspace.getConfiguration("dirac.architectureBoard").update("style", style, vscode.ConfigurationTarget.Global)
}
