import { useState } from "react"
import type { ArchitectureSelection } from "@shared/architecture"
import { BoardClient } from "@/architecture-board/boardClient"

/** Persistent navigation, deliberately independent of CardActions and onAction. */
export function ArchitectureNavigation({ selection }: { selection: ArchitectureSelection }) {
	const [error, setError] = useState<string>()
	const [opening, setOpening] = useState(false)
	return (
		<span className="flex flex-col items-end text-xs">
			<button
				type="button"
				disabled={opening}
				className="rounded px-2 py-1 hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring"
				onClick={async () => {
					setOpening(true)
					setError(undefined)
					try {
						await BoardClient.open(selection)
					} catch (error) {
						setError(error instanceof Error ? error.message : String(error))
					} finally {
						setOpening(false)
					}
				}}>
				{opening ? "Opening…" : selection.mode === "comparison" ? "Open comparison" : "Open diagram"}
			</button>
			{error && <span role="alert">{error}</span>}
		</span>
	)
}
