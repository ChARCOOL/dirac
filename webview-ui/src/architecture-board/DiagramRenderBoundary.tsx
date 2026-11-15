import { Component, type PropsWithChildren } from "react"
import type { ArchitectureDiagram } from "@shared/architecture"

/** A renderer crash must not erase the saved semantics or the other comparison pane. */
export class DiagramRenderBoundary extends Component<PropsWithChildren<{ diagram: ArchitectureDiagram }>, { error?: string }> {
	state: { error?: string } = {}
	static getDerivedStateFromError(error: Error) {
		return { error: error.message }
	}
	render() {
		if (!this.state.error) return this.props.children
		const { diagram } = this.props
		return (
			<div role="alert">
				<p>Graph renderer unavailable: {this.state.error}</p>
				<button onClick={() => this.setState({ error: undefined })}>Retry renderer</button>
				<p>{diagram.summary}</p>
				<ul>
					{diagram.nodes.map((node) => (
						<li key={node.id}>
							{node.kind}: {node.label} — {node.description} {node.rationale}
						</li>
					))}
				</ul>
				<ul>
					{diagram.edges.map((edge) => (
						<li key={edge.id}>
							{edge.kind}: {edge.source} → {edge.target} — {edge.label} {edge.description}
						</li>
					))}
				</ul>
				<p>Ordinary chat remains available. Architectural changes belong in the owning conversation.</p>
			</div>
		)
	}
}
