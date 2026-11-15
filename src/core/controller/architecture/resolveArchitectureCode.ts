import fs from "node:fs/promises"
import path from "node:path"
import type { CodeReference } from "@shared/architecture"
import { DiracIgnorePolicy } from "@shared/ignore/DiracIgnorePolicy"
import { workspaceResolver } from "@core/workspace/WorkspaceResolver"

export interface ArchitectureWorkspace {
	cwd: string
	roots: { name?: string; path: string }[]
}

/** Never consults selected/global workspaces, executes commands, or follows links outside the owning root. */
export async function resolveArchitectureCode(workspace: ArchitectureWorkspace, reference: CodeReference): Promise<string> {
	const qualified = /^@([^:]+):(.*)$/.exec(reference.path)
	const root = qualified
		? workspace.roots.find((root) => (root.name ?? path.basename(root.path)) === qualified[1])?.path
		: workspace.cwd
	if (!root) throw new Error("The referenced workspace is not recorded for this task; navigation is unavailable")
	const relative = qualified ? qualified[2] : reference.path
	const resolved = workspaceResolver.resolveWorkspacePath(root, relative, "ArchitectureCode") as string
	const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(resolved)])
	const within = path.relative(realRoot, realFile)
	if (within === ".." || within.startsWith(`..${path.sep}`) || path.isAbsolute(within))
		throw new Error("Code reference leaves its owning workspace")
	const policy = new DiracIgnorePolicy(root)
	await policy.reload()
	if (!policy.allowsAbsolutePath(resolved) || !policy.allowsAbsolutePath(path.resolve(root, within)))
		throw new Error("Code reference is blocked by .diracignore")
	if (!(await fs.stat(realFile)).isFile()) throw new Error("Code reference is not a file")
	return realFile
}
