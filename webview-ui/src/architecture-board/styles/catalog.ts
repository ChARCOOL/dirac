import earth from "./earth/style"
import linen from "./linen/style"
import type { BoardStyle } from "./types"

// Deliberately excludes React, CSS and DOM: this catalog is safe in the layout worker.
const modules = import.meta.glob<{ default: BoardStyle }>("./*/style.ts", { eager: true })
export const boardStyles = Object.values(modules)
	.map((module) => module.default)
	.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
const stylesById = new Map<string, BoardStyle>()
for (const style of boardStyles) {
	if (!/^[a-z][a-z0-9-]*$/.test(style.id) || stylesById.has(style.id))
		throw new Error(`Invalid or duplicate board style: ${style.id}`)
	stylesById.set(style.id, style)
}

/** A removed/renamed style preference is not a broken board. */
export function resolveBoardStyle(id?: string, appearance: "light" | "dark" = "dark"): BoardStyle {
	return (id && stylesById.get(id)) || (appearance === "light" ? linen : earth)
}
