import { boardGeometry } from "../boardGeometry"
import type { BoardStyle } from "../types"

export default {
	id: "linen",
	label: "Linen",
	order: 0,
	geometry: boardGeometry,
	nodeGradient: true,
	edgeWidth: 1.05,
	dataDash: [2, 5],
	dependencyDash: [8, 5],
	messageDash: [8, 4, 1, 4],
} satisfies BoardStyle
