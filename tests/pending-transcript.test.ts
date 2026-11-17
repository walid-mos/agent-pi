import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
	markAnswered,
	TranscriptComponent,
} from '../extensions/lib/ui/transcript-component.ts'

import type { PendingRowState } from '../extensions/lib/ui/transcript-component.ts'

test('pending rows resize until answered and then disappear', () => {
	const state = { answered: false }
	const row = TranscriptComponent.pending(state, width => [
		'Pending'.slice(0, width),
	])
	assert.deepEqual(row.render(3), ['Pen'])
	assert.deepEqual(row.render(7), ['Pending'])
	state.answered = true
	assert.deepEqual(row.render(7), [])
})

test('marking a row answered hides its pending call and redraws once after the frame', async () => {
	const state: PendingRowState = {}
	let redraws = 0
	const row = TranscriptComponent.pending(state, () => ['Pending'])
	const invalidate = (): void => {
		redraws += 1
	}
	markAnswered({ state, invalidate })
	markAnswered({ state, invalidate })
	assert.deepEqual(row.render(7), [])
	assert.equal(redraws, 0)
	await Promise.resolve()
	assert.equal(redraws, 1)
})
