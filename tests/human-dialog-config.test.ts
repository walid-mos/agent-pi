import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createEventBus } from '@earendil-works/pi-coding-agent'

import {
	brokerFlagReader,
	configuredBroker,
	registerBrokerFlags,
} from '../extensions/lib/human-dialog/config.ts'

import type { EventBus } from '@earendil-works/pi-coding-agent'

const context = {
	sessionManager: { getSessionFile: () => '/sessions/fixture.jsonl' },
}

test('normal local interaction needs no broker or worker metadata', () => {
	assert.equal(
		configuredBroker({ getFlag: () => undefined }, context, 'call'),
		undefined,
	)
})

function flagOwner(
	events: EventBus,
	worker: string,
): Parameters<typeof registerBrokerFlags>[0] {
	return {
		events,
		registerFlag: () => undefined,
		getFlag: flag =>
			flag === 'human-dialog-worker' ? worker : '/installed/human.mjs',
	}
}

test('a session where no extension owns the broker flags keeps the local secret dialog', () => {
	const reader = brokerFlagReader({ events: createEventBus() })
	assert.equal(configuredBroker(reader, context, 'call'), undefined)
})

test('a session bus answered by two broker flag owners fails instead of picking a worker', () => {
	const events = createEventBus()
	registerBrokerFlags(flagOwner(events, 'worker-a'))
	registerBrokerFlags(flagOwner(events, 'worker-b'))
	assert.throws(() => brokerFlagReader({ events }), /Several extensions/)
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
