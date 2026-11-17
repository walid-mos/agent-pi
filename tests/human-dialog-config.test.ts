import assert from 'node:assert/strict'
import { test } from 'node:test'

import { configuredBroker } from '../extensions/lib/human-dialog/config.ts'

const context = {
	sessionManager: { getSessionFile: () => '/sessions/fixture.jsonl' },
}

test('normal local interaction needs no broker or worker metadata', () => {
	assert.equal(
		configuredBroker({ getFlag: () => undefined }, context, 'call'),
		undefined,
	)
})

test('an opted-in worker with missing session or invalid metadata fails instead of falling back to local', () => {
	const missingSession = {
		sessionManager: { getSessionFile: () => undefined },
	}
	assert.throws(
		() =>
			configuredBroker(
				{
					getFlag: flag =>
						flag === 'human-dialog-worker'
							? 'worker'
							: '/installed/human.mjs',
				},
				missingSession,
				'call',
			),
		/persisted absolute Pi session/,
	)
	assert.throws(
		() => configuredBroker({ getFlag: () => '' }, context, 'call'),
		/require a worker name/,
	)
	assert.throws(
		() =>
			configuredBroker(
				{
					getFlag: flag =>
						flag === 'human-dialog-worker'
							? 'worker'
							: 'relative.mjs',
				},
				context,
				'call',
			),
		/absolute broker script/,
	)
})
