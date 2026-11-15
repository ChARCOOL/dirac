import * as vscode from "vscode"

/** File navigation only. The controller resolves and authorizes the path against the owning task. */
export async function openArchitectureCode(
	absolutePath: string,
	line: number | undefined,
	symbol: string | undefined,
	assertCurrent: () => void,
): Promise<void> {
	assertCurrent()
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath))
	assertCurrent()
	let range: vscode.Range | undefined
	if (line !== undefined) {
		if (line > document.lineCount) throw new Error(`Code reference line ${line} no longer exists`)
		range = new vscode.Range(line - 1, 0, line - 1, 0)
	} else if (symbol) {
		const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
			"vscode.executeDocumentSymbolProvider",
			document.uri,
		)
		assertCurrent()
		const matches: vscode.Range[] = []
		const visit = (entries: (vscode.DocumentSymbol | vscode.SymbolInformation)[], prefix = "") => {
			for (const entry of entries) {
				const qualified = prefix ? `${prefix}.${entry.name}` : entry.name
				if (entry.name === symbol || qualified === symbol)
					matches.push("selectionRange" in entry ? entry.selectionRange : entry.location.range)
				if ("children" in entry) visit(entry.children, qualified)
			}
		}
		visit(symbols ?? [])
		if (matches.length !== 1)
			throw new Error(`Code symbol '${symbol}' is missing or ambiguous; ask Dirac to refresh this code reference`)
		range = matches[0]
	}
	await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true, selection: range })
}
