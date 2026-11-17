import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TranscriptComponent } from '../extensions/lib/ui/transcript-component.ts'

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
