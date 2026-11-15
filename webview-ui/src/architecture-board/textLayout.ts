import type { NodeKind } from "@shared/architecture"
import type { ShapeSize } from "./styles/types"

export const TITLE_FONT_SIZE = 18
export const TITLE_LINE_HEIGHT = 25
export const MIN_READING_ZOOM = 14 / TITLE_FONT_SIZE
export const TITLE_FONT_FAMILY = '"Board Inter", system-ui, sans-serif'
export const TITLE_FONT = `500 ${TITLE_FONT_SIZE}px ${TITLE_FONT_FAMILY}`
export type TextMeasure = (text: string) => number
export interface TextFit {
	lines: string[]
	truncated: boolean
}
export interface TextBox extends ShapeSize {
	x: number
	y: number
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const words = new Intl.Segmenter(undefined, { granularity: "word" })

/** Prefer word/identifier boundaries, but never split an emoji or combining sequence. */
function textBreaks(text: string, segments: string[]): Set<number> {
	const offsets = new Map<number, number>([[0, 0]])
	let offset = 0
	segments.forEach((segment, index) => {
		offset += segment.length
		offsets.set(offset, index + 1)
	})
	const breaks = new Set<number>([segments.length])
	for (const word of words.segment(text)) {
		const end = offsets.get(word.index + word.segment.length)
		if (end !== undefined) breaks.add(end)
	}
	for (let index = 1; index < segments.length; index++) {
		if (/[\s./_:\-]$/u.test(segments[index - 1]) || (/[a-z]$/u.test(segments[index - 1]) && /^[A-Z]/u.test(segments[index])))
			breaks.add(index)
	}
	return breaks
}

/** Bounded, measured wrapping. Final-line ellipsis is measured with the text, never appended outside the box. */
export function fitText(label: string, width: number, maxLines: number, measure: TextMeasure): TextFit {
	if (width <= 0 || maxLines < 1) return { lines: [], truncated: label.length > 0 }
	const text = label
		.replace(/\r\n?/gu, "\n")
		.replace(/[^\S\n]+/gu, " ")
		.trim()
	const segments = Array.from(graphemes.segment(text), ({ segment }) => segment)
	const breaks = textBreaks(text, segments)
	const lines: string[] = []
	let start = 0
	while (start < segments.length && lines.length < maxLines) {
		const newline = segments.indexOf("\n", start)
		const end = newline < 0 ? segments.length : newline
		const last = lines.length === maxLines - 1
		const remaining = segments.slice(start, end).join("").trimEnd()
		if (measure(remaining) <= width && (!last || end === segments.length)) {
			lines.push(remaining)
			start = end < segments.length ? end + 1 : end
			continue
		}
		const suffix = last ? "…" : ""
		let low = start
		let high = end
		while (low < high) {
			const mid = Math.ceil((low + high) / 2)
			const candidate = segments.slice(start, mid).join("").trimEnd() + suffix
			if (measure(candidate) <= width) low = mid
			else high = mid - 1
		}
		// A box smaller than one grapheme is still bounded; the full label remains in details.
		if (last || low === start) {
			lines.push(measure(suffix || "…") <= width ? segments.slice(start, low).join("").trimEnd() + (suffix || "…") : "")
			return { lines, truncated: true }
		}
		let boundary = low
		while (boundary > start && !breaks.has(boundary)) boundary--
		// A short complete word is preferable to splitting the next word just to fill the line.
		if (boundary > start) low = boundary
		lines.push(segments.slice(start, low).join("").trimEnd())
		start = low
		while (segments[start] === " ") start++
	}
	return { lines, truncated: start < segments.length }
}

/** Conservative interior rectangles shared by fitting and rendering, including nonrectangular silhouettes. */
export function nodeTextRegions(kind: NodeKind, size: ShapeSize, proposal = false) {
	const { width: w, height: h } = size
	if (kind === "group") {
		return { title: { x: 24, y: -14, width: Math.max(0, w - 48), height: 28 }, descriptor: undefined, badge: undefined }
	}
	let left = 24,
		right = 24,
		top = 18,
		bottom = 18
	if (kind === "class") top = h * 0.3 + 12
	if (kind === "component") left = 30
	if (kind === "database") {
		left = right = 18
		top = 58
		bottom = 38
	}
	if (kind === "api_endpoint") {
		left = w * 0.18 + 16
		right = 20
		top = bottom = 24
	}
	if (kind === "service") left = right = 32
	if (kind === "function") {
		left = right = h / 2 + 8
		top = bottom = 12
	}
	if (kind === "actor") {
		// The inset square lies wholly inside the circle, even at its corners.
		left = right = (w - Math.min(w, h) / Math.SQRT2) / 2 + 4
		top = bottom = (h - Math.min(w, h) / Math.SQRT2) / 2 + 4
	}
	const descriptor =
		kind === "class"
			? { x: left, y: Math.max(18, h * 0.3 - 28), width: w - left - right, height: 14 }
			: { x: left, y: top, width: w - left - right, height: 14 }
	if (kind !== "class") top += 22
	const badge = proposal ? { x: left, y: h - bottom - 18, width: w - left - right, height: 18 } : undefined
	if (proposal) bottom += 26
	return {
		title: { x: left, y: top, width: Math.max(0, w - left - right), height: Math.max(0, h - top - bottom) },
		descriptor,
		badge,
	}
}

/** Three deterministic size tiers; prefer complete labels before truncating at the maximum tier. */
export function sizeNodeForText(
	kind: Exclude<NodeKind, "group">,
	label: string,
	base: ShapeSize,
	proposal: boolean,
	measure: TextMeasure,
): ShapeSize {
	let result = base
	let mostVisible = -1
	for (const scale of [1, 1.2, 1.4]) {
		const size = { width: Math.ceil(base.width * scale), height: Math.ceil(base.height * scale) }
		const box = nodeTextRegions(kind, size, proposal).title
		const fit = fitText(label, box.width - 1, Math.min(4, Math.floor(box.height / TITLE_LINE_HEIGHT)), measure)
		if (!fit.truncated) return size
		const visible = fit.lines.join("").length
		if (visible > mostVisible) {
			result = size
			mostVisible = visible
		}
	}
	return result
}
