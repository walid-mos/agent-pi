import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BrokerDialog } from '../extensions/lib/human-dialog/broker.ts'
import { bindCompletion } from '../extensions/lib/human-dialog/completion.ts'

import type { BrokerRequest } from '../extensions/lib/human-dialog/schema.ts'

const request: BrokerRequest = {
	kind: 'question',
	source: {
		type: 'worker',
		worker: 'fixture',
		session: '/sessions/fixture.jsonl',
		call: 'call-1',
	},
	policy: 'ordinary',
	context: 'Choose',
	questions: [
		{
			id: 'target',
			prompt: 'Where?',
			multiple: false,
			options: [{ label: 'Preview', detail: '', recommended: false }],
		},
	],
}

test('rejects a receipt for another tool call before completing the local dialog', async () => {
	const dialog = new BrokerDialog(request, async () => ({
		id: 'wrong-call',
		kind: 'question',
		policy: 'ordinary',
	}))
	await assert.rejects(dialog.open(), /does not match/)
})

test('external winner closes a waiting dialog exactly once while terminal submission is pending', async () => {
	const external = Promise.withResolvers<string>()
	const terminal = Promise.withResolvers<string>()
	const completed = Promise.withResolvers<void>()
	const outcomes: unknown[] = []
	const submit = bindCompletion(
		{ wait: external.promise, submit: () => terminal.promise },
		outcome => {
			outcomes.push(outcome)
			completed.resolve()
		},
	)
	submit('terminal draft')
	external.resolve('discord winner')
	await completed.promise
	terminal.resolve('late terminal')
	await terminal.promise
	submit('stale keypress')
	assert.deepEqual(outcomes, [{ ok: true, value: 'discord winner' }])
})

test('broker failure closes the waiting local dialog as failure instead of consent', async () => {
	const waiting = Promise.withResolvers<string>()
	const completed = Promise.withResolvers<unknown>()
	bindCompletion(
		{ wait: waiting.promise, submit: async outcome => outcome },
		completed.resolve,
	)
	const failure = new Error('broker unavailable')
	waiting.reject(failure)
	assert.deepEqual(await completed.promise, { ok: false, error: failure })
})
