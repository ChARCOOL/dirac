import { createContext, useContext, type ComponentType, type ReactNode, type CSSProperties } from "react"
import { nodeTextRegions } from "../textLayout"
import type { NodeKind } from "@shared/architecture"
import earth from "./earth/style"
import type { BoardStyle } from "./types"
import "./styles.css"

// UI-only discovery. Never import this file from layout or geometry code.
import.meta.glob("./*/style.css", { eager: true })
const appearances = import.meta.glob<{ default: ComponentType<NodeAppearanceProps> }>("./*/NodeAppearance.tsx", { eager: true })
const presentations = import.meta.glob<StylePresentation>("./*/Presentation.tsx", { eager: true })

export interface NodeAppearanceProps {
	kind: NodeKind
	width: number
	height: number
}
export interface NodeContentProps extends NodeAppearanceProps {
	label: string
	title: ReactNode
}
interface StylePresentation {
	NodeContent?: ComponentType<NodeContentProps>
	GroupHeader?: ComponentType<NodeContentProps>
	LegendGlyph?: ComponentType<NodeAppearanceProps>
}
export const BoardStyleContext = createContext<BoardStyle>(earth)
export const useBoardStyle = () => useContext(BoardStyleContext)

export function StyleNodeAppearance(props: NodeAppearanceProps) {
	const style = useBoardStyle()
	if (props.width === 0 || props.height === 0) return null
	const Appearance = appearances[`./${style.id}/NodeAppearance.tsx`]?.default
	return Appearance ? <Appearance {...props} /> : null
}

/** Styles compose meaning; the shell still owns measurements, handles and review UI. */
export function StyleNodeContent(props: NodeContentProps) {
	const style = useBoardStyle()
	const presentation = presentations[`./${style.id}/Presentation.tsx`]
	const Content = props.kind === "group" ? presentation?.GroupHeader : presentation?.NodeContent
	const { descriptor } = nodeTextRegions(props.kind, props)
	return (
		<div
			className="node-content"
			style={
				{
					padding: 0,
					inset: 0,
					display: "block",
					"--descriptor-x": `${descriptor?.x ?? 0}px`,
					"--descriptor-y": `${descriptor?.y ?? 0}px`,
					"--descriptor-width": `${descriptor?.width ?? 0}px`,
				} as CSSProperties
			}>
			{Content ? <Content {...props} /> : props.title}
		</div>
	)
}

export function StyleLegendGlyph({ fallback, ...props }: NodeAppearanceProps & { fallback: ReactNode }) {
	const style = useBoardStyle()
	const Glyph = presentations[`./${style.id}/Presentation.tsx`]?.LegendGlyph
	return Glyph ? <Glyph {...props} /> : <>{fallback}</>
}
