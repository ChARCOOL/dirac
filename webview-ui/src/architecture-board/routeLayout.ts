import type { ArchitectureDiagram } from "@shared/architecture"
import type { LayoutOutput } from "./layoutGraph"
import { cleanLayoutRoutes } from "./routeCleanup"
import { dockShapeRoutes, envelopeRoutes, optimizeRoutePorts } from "./routePorts"
import { planLineJumps } from "./lineJumps"
import type { NodeGeometry } from "./styles/types"

/** Placement stays fixed. First establish safe routes, then improve ports and dock to silhouettes. */
export function routeLayout(diagram: ArchitectureDiagram, layout: LayoutOutput, requireRoutes = false, geometry?: NodeGeometry) {
	const cleaned = cleanLayoutRoutes(diagram, { ...layout, routes: envelopeRoutes(diagram, layout) }, requireRoutes)
	if (cleaned.metrics.unbridged) return cleaned
	const optimized = optimizeRoutePorts(diagram, cleaned.layout, geometry)
	const docked = dockShapeRoutes(diagram, optimized.layout, geometry)
	const planned = planLineJumps(diagram, docked)
	if (requireRoutes && planned.issues.length) throw new Error("Not enough room at shaped ports for relationship hops.")
	return {
		layout: { ...docked, decorations: planned.decorations },
		metrics: {
			...cleaned.metrics,
			retained: cleaned.metrics.retained.filter((id) => !optimized.changed.includes(id)),
			restored: cleaned.metrics.restored.filter((id) => !optimized.changed.includes(id)),
			portChecks: optimized.checks,
			reattached: optimized.changed,
			unbridged: planned.issues.length,
		},
	}
}
