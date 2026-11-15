import { useState } from "react"
import { ArrowRight, ArrowUpRight, Crosshair, X, MessageSquare, Layers } from "lucide-react"
import type { ArchitectureDiagram, ResolvedArchitectureIdentity } from "@shared/architecture"
import { BoardClient } from "./boardClient"
import type { CommentReviews, CommentReview } from "./CommentReviews"
import { CommentThread } from "./CommentThread"
import { RelationshipLegend } from "./RelationshipLegend"
import { NodeShapeLegend } from "./NodeSilhouette"
import { NODE_KIND_LABELS } from "./nodeShapes"

export type BoardTarget = { kind: "node" | "edge"; id: string }
export function Inspector({
	diagram,
	identity,
	target,
	select,
	reviews,
	review,
	close,
	focus,
}: {
	diagram: ArchitectureDiagram
	identity: ResolvedArchitectureIdentity
	target?: BoardTarget
	select: (target?: BoardTarget) => void
	reviews: CommentReviews
	review?: CommentReview
	close?: () => void
	focus?: (id: string) => void
}) {
	const [error, setError] = useState<string>()
	const element = target && (target.kind === "node" ? diagram.nodes : diagram.edges).find((item) => item.id === target.id)
	const names = new Map(diagram.nodes.map((node) => [node.id, node.label]))
	const relationships =
		target?.kind === "node" ? diagram.edges.filter((edge) => edge.source === target.id || edge.target === target.id) : []
	const openCode = async (referenceIndex: number) => {
		setError(undefined)
		try {
			await BoardClient.openCode({ ...identity, targetKind: target!.kind, targetId: target!.id, referenceIndex })
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error))
		}
	}
	const choose = (next?: BoardTarget) => {
		setError(undefined)
		select(next)
	}
	return (
		<aside className="board-inspector" aria-label={`Inspector version ${identity.version}`} tabIndex={-1}>
			<div className="inspector-heading">
				<h3>{element ? "Element details" : "Diagram overview"}</h3>
				{close && (
					<button aria-label="Close details" onClick={close}>
						<X size={16} />
					</button>
				)}
			</div>
			<div className="inspector-tabs">
				<button aria-pressed={!target} onClick={() => choose(undefined)}>
					<Layers size={14} />
					Diagram & comments
				</button>
			</div>
			<label className="element-picker">
				Inspect element
				<select
					value={target ? `${target.kind}:${target.id}` : ""}
					onChange={(event) => {
						const value = event.target.value
						choose(value ? { kind: value.startsWith("node:") ? "node" : "edge", id: value.slice(5) } : undefined)
					}}>
					<option value="">Diagram</option>
					<optgroup label="Elements">
						{diagram.nodes.map((node) => (
							<option key={`node:${node.id}`} value={`node:${node.id}`}>
								{NODE_KIND_LABELS[node.kind]}: {node.label}
							</option>
						))}
					</optgroup>
					<optgroup label="Relationships">
						{diagram.edges.map((edge) => (
							<option key={`edge:${edge.id}`} value={`edge:${edge.id}`}>
								{edge.kind}: {edge.label ?? `${names.get(edge.source)} → ${names.get(edge.target)}`}
							</option>
						))}
					</optgroup>
				</select>
			</label>
			{element ? (
				<>
					<span className="inspector-eyebrow">
						{"source" in element ? element.kind.replaceAll("_", " ") : NODE_KIND_LABELS[element.kind]}
					</span>
					<h4 className="element-title">{element.label ?? "Relationship"}</h4>
					{target?.kind === "node" && focus && (
						<button onClick={() => focus(target.id)}>
							<Crosshair size={14} />
							Focus on canvas
						</button>
					)}
					{"source" in element && (
						<div className="relationship-endpoints">
							<button onClick={() => choose({ kind: "node", id: element.source })}>
								{names.get(element.source)}
							</button>
							<ArrowRight size={16} />
							<button onClick={() => choose({ kind: "node", id: element.target })}>
								{names.get(element.target)}
							</button>
						</div>
					)}
					{element.change && (
						<p className={`proposal change-${element.change}`}>
							Proposed: {element.change} (relative to current code, not a version diff)
						</p>
					)}
					{element.description && (
						<>
							<h4>Responsibility</h4>
							<p>{element.description}</p>
						</>
					)}
					{element.rationale && (
						<>
							<h4>Rationale</h4>
							<p>{element.rationale}</p>
						</>
					)}
					{!!relationships.length && (
						<div className="relationship-list">
							<h4>
								Relationships <span className="count-pill">{relationships.length}</span>
							</h4>
							{relationships.map((edge) => (
								<button key={edge.id} onClick={() => choose({ kind: "edge", id: edge.id })}>
									<span className="relationship-direction">
										{edge.source === target!.id ? "TO" : "FROM"} ·{" "}
										{names.get(edge.source === target!.id ? edge.target : edge.source)}
									</span>
									<strong>{edge.label ?? edge.kind.replaceAll("_", " ")}</strong>
									<small>{edge.kind.replaceAll("_", " ")}</small>
								</button>
							))}
						</div>
					)}
					{!!element.code?.length && (
						<>
							<h4>Related code</h4>
							<ul className="code-links">
								{element.code.map((code, index) => (
									<li key={index}>
										<button onClick={() => void openCode(index)}>
											<ArrowUpRight size={14} />
											<span>
												{code.path}
												{code.symbol ? ` · ${code.symbol}` : ""}
												{code.line ? `:${code.line}` : ""}
											</span>
										</button>
									</li>
								))}
							</ul>
						</>
					)}
				</>
			) : (
				<>
					<h4 className="element-title">{diagram.title}</h4>
					<small className="diagram-metadata">
						{diagram.nodes.length} nodes · {diagram.edges.length} relationships
					</small>
					<p>{diagram.summary}</p>
					<details className="diagram-legend">
						<summary>Reading the diagram</summary>
						<NodeShapeLegend kinds={diagram.nodes.map((node) => node.kind)} />
						<p>
							Silhouettes identify types. Open frames mark subsystem boundaries; line patterns identify
							relationships.
						</p>
						<RelationshipLegend kinds={diagram.edges.map((edge) => edge.kind)} />
						<p>
							Select an element or relationship for a quick preview. Details & comments opens this panel.
							Double-click a component or group to focus.
						</p>
						<p>
							Tab focuses elements. Enter previews. Arrow keys move focused nodes. Escape closes details first, then
							the preview. Structure is read-only.
						</p>
					</details>
				</>
			)}
			<div className="inspector-comments">
				<MessageSquare size={15} aria-hidden="true" />
				<CommentThread identity={identity} target={target ?? { kind: "diagram" }} review={review} reviews={reviews} />
			</div>
			{element && (
				<details className="element-identity">
					<summary>Element identity</summary>
					<code>{element.id}</code>
				</details>
			)}
			{error && <p role="alert">Code navigation failed: {error}</p>}
		</aside>
	)
}
