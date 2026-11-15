/** Transient renderer geometry shared by the worker and edge views; never persisted. */
export interface LineJump {
	segment: number
	from: number
	to: number
	radius: number
	side: number
}
export interface LineGap {
	segment: number
	at: number
	across: number
	jump: LineJump
}
export interface RouteJumps {
	jumps: LineJump[]
	gaps: LineGap[]
}
