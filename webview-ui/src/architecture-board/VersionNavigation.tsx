import { useRef, useState } from "react"
import { ArrowRight, ChevronDown } from "lucide-react"
import type { ArchitectureSelection } from "@shared/architecture"

/** Version controls stay beside the identity they navigate, never inside presentation controls. */
export function VersionNavigation({
	taskId,
	name,
	version,
	latestVersion,
	latestVersionError,
	followingLatest,
	comparison = false,
	navigate,
}: {
	taskId: string
	name: string
	version: number
	latestVersion?: number
	latestVersionError?: string
	followingLatest?: boolean
	comparison?: boolean
	navigate: (selection: ArchitectureSelection) => void
}) {
	const menu = useRef<HTMLDetailsElement>(null)
	const [requestedVersion, setRequestedVersion] = useState(String(version))
	const open = (selection: ArchitectureSelection) => {
		menu.current!.open = false
		menu.current!.querySelector("summary")?.focus()
		navigate(selection)
	}
	return (
		<>
			<details
				className="board-version-menu"
				ref={menu}
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape" && event.currentTarget.open) {
						event.currentTarget.open = false
						event.currentTarget.querySelector("summary")?.focus()
						event.stopPropagation()
					}
				}}>
				<summary
					className="version-badge"
					aria-label={`Version ${version} options`}
					title={followingLatest ? "Following latest version" : "Version history and navigation"}>
					Version {version}
					<ChevronDown size={12} aria-hidden="true" />
				</summary>
				<div className="version-menu-content">
					<p>
						{followingLatest ? "Following latest" : "Fixed snapshot"}
						{latestVersion === version ? " · Latest version" : ""}
					</p>
					{latestVersionError && <p role="status">Could not check for updates: {latestVersionError}</p>}
					<form
						onSubmit={(event) => {
							event.preventDefault()
							const next = Number(requestedVersion)
							if (Number.isSafeInteger(next) && next > 0) open({ taskId, name, mode: "exact", version: next })
						}}>
						<label>
							Version
							<input
								aria-label="Version to open"
								type="number"
								min={1}
								max={latestVersion ?? Number.MAX_SAFE_INTEGER}
								step={1}
								required
								value={requestedVersion}
								onChange={(event) => setRequestedVersion(event.target.value)}
							/>
						</label>
						<button type="submit">Open version</button>
					</form>
					{!comparison && !followingLatest && (
						<button onClick={() => open({ taskId, name, mode: "latest" })}>Follow latest</button>
					)}
				</div>
			</details>
			{latestVersion !== undefined && latestVersion > version && (
				<button
					className="version-update"
					title={`View version ${latestVersion}`}
					onClick={() => navigate({ taskId, name, mode: "exact", version: latestVersion })}>
					v{latestVersion} available
					<ArrowRight size={13} aria-hidden="true" />
				</button>
			)}
		</>
	)
}
