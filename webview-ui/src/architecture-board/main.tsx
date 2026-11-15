import React from "react"
import { createRoot } from "react-dom/client"
import { Board } from "./Board"
import "@xyflow/react/dist/style.css"
import "./board.css"
import "./fonts/fonts.css"
import "./typography.css"
import { loadBoardFonts } from "./measureText"

class BoardErrorBoundary extends React.Component<React.PropsWithChildren, { error?: string }> {
	state: { error?: string } = {}
	static getDerivedStateFromError(error: Error) {
		return { error: error.message }
	}
	render() {
		return this.state.error ? (
			<main role="alert">
				<h1>Architecture viewer failed</h1>
				<p>{this.state.error}</p>
				<p>Reopen the board to retry. Ordinary chat remains available.</p>
			</main>
		) : (
			this.props.children
		)
	}
}

const root = document.getElementById("root")!
const reactRoot = createRoot(root)
void loadBoardFonts()
	.then(() => {
		reactRoot.render(
			<BoardErrorBoundary>
				<Board
					taskId={root.dataset.taskId!}
					nativeZenMode={root.dataset.nativeZenMode === "true"}
					initialStyle={root.dataset.boardStyle}
				/>
			</BoardErrorBoundary>,
		)
	})
	.catch((error: unknown) => {
		reactRoot.render(<main role="alert">Architecture fonts failed to load: {String(error)}. Reopen the board to retry.</main>)
	})
