import assert from 'node:assert/strict'

import { defaultConfig } from '../../extensions/model/fallback/config.ts'
import {
	failoverAfterAbort,
	performFailover,
} from '../../extensions/model/fallback/failover.ts'
import { FallbackSession } from '../../extensions/model/fallback/fallback-session.ts'

const [, , scenario] = process.argv
const isWatchdog = scenario.startsWith('watchdog-')
const config = { ...defaultConfig(), chain: ['fixture/backup'] }
const session = new FallbackSession(config)
const abort = new AbortController()
const entered = Promise.withResolvers()
const release = Promise.withResolvers()
const original = { provider: 'fixture', id: 'main' }
const next = { provider: 'fixture', id: 'backup' }
const failure = { model: 'fixture/main', reason: 'HTTP 502' }
const statuses = []
const notifications = []
const messages = []
const levels = []
let sessionId = 'original-session'
let selectedModel = original
const pi = {
	getThinkingLevel: () => 'high',
	setThinkingLevel: level => levels.push(level),
	setModel: async model => {
		entered.resolve()
		await release.promise
		selectedModel = model
		session.consumeSwitch(`${model.provider}/${model.id}`)
		return true
	},
	sendMessage: message => messages.push(message),
}
const context = {
	get model() {
		return selectedModel
	},
	signal: abort.signal,
	hasPendingMessages: () => false,
	modelRegistry: {
		find: (provider, id) =>
			provider === next.provider && id === next.id ? next : undefined,
		hasConfiguredAuth: () => true,
	},
	sessionManager: {
		getSessionId: () => sessionId,
		getBranch: () => [],
	},
	ui: {
		notify: message => notifications.push(message),
		setStatus: (_key, status) => statuses.push(status),
	},
}

if (isWatchdog) abort.abort()
const completion = isWatchdog
	? failoverAfterAbort(pi, context, session, failure)
	: performFailover(pi, context, session, failure)
await entered.promise
if (scenario === 'abort') abort.abort()
if (scenario.endsWith('session')) {
	sessionId = 'new-session'
	session.startSession(config)
}
release.resolve()
const continuation = await completion
assert.equal(selectedModel.id, next.id)
if (scenario.endsWith('success')) {
	assert.equal(session.restoreModel(), failure.model)
	assert.equal(session.thinkingLevelToRestore(), 'high')
	assert.deepEqual(levels, ['high'])
	assert.deepEqual(statuses, ['↯ fixture/backup (fallback)'])
	assert.equal(notifications.length, 1)
	if (isWatchdog) {
		assert.equal(messages.length, 1)
		assert.match(
			messages[0].content,
			/resume it from its last verified result/,
		)
	} else {
		assert.equal(continuation.continue, true)
		assert.equal(continuation.entries.length, 1)
	}
} else {
	assert.equal(continuation, undefined)
	assert.equal(
		session.restoreModel(),
		undefined,
		'a discarded switch must not schedule restoration of the old session model',
	)
	assert.equal(session.thinkingLevelToRestore(), undefined)
	assert.equal(
		session.shouldRecoverAtBoundary('completed', Number.MAX_SAFE_INTEGER),
		false,
	)
	assert.deepEqual(
		levels,
		[],
		'a discarded switch must not change the reasoning level',
	)
	assert.deepEqual(statuses, [])
	assert.deepEqual(notifications, [])
	assert.deepEqual(messages, [])
}
