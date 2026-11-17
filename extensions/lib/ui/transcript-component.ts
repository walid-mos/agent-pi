/** Stateless transcript renderer: no cached output, each render uses the current viewport.
 * A pending call row shows until its result row marks the shared row state answered. */
import type { Component } from '@earendil-works/pi-tui'

export interface PendingRowState {
	answered?: boolean
}

export class TranscriptComponent implements Component {
	constructor(private readonly build: (width: number) => string[]) {}
	static pending(
		state: Readonly<PendingRowState>,
		build: (width: number) => string[],
	): TranscriptComponent {
		return new TranscriptComponent(width =>
			state.answered ? [] : build(width),
		)
	}
	invalidate(): void {
		// Pi requires this hook even for stateless renderers.
		return
	}
	render(width: number): string[] {
		return this.build(width)
	}
}

export function markAnswered(row: {
	state: PendingRowState
	invalidate: () => void
}): void {
	if (row.state.answered) return
	// oxlint-disable-next-line eslint/no-param-reassign - Pi owns this mutable cross-slot state channel
	row.state.answered = true
	// Do not reenter Pi's in-flight display update synchronously.
	queueMicrotask(() => row.invalidate())
}
