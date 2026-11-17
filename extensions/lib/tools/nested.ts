/** Helpers for tools that run other tools through `ctx.executeTool`. */
import type { ExecuteToolOptions } from '@earendil-works/pi-coding-agent'

/** `exactOptionalPropertyTypes`: an absent signal must stay absent, not `undefined`. */
export function nestedOptions(
	signal: AbortSignal | undefined,
): ExecuteToolOptions {
	if (!signal) return {}
	return { signal }
}
