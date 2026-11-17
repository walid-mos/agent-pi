import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BrokerDialog } from '../extensions/lib/human-dialog/broker.ts'
import { bindCompletion } from '../extensions/lib/human-dialog/completion.ts'
import {
	dialogId,
	questionDigest,
} from '../extensions/lib/human-dialog/receipt.ts'

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

test('rejects an answer rebound to a delivery the dialog never registered', async () => {
	const pinned = dialogId(request)
	const answered = {
		status: 'answered',
		origin: 'discord',
		answers: [{ id: 'target', labels: ['Preview'], text: '' }],
		dialog: pinned,
		request: 'door-b',
		digest: questionDigest(request),
		at: 1,
		evidence: {
			clicks: [
				{
					question: 'target',
					userId: '10000000000000001',
					guildId: '20000000000000002',
					messageUrl:
						'https://discord.com/channels/20000000000000002/30000000000000003/40000000000000004',
					at: '2026-11-01T00:00:00.000Z',
				},
			],
		},
	} as const
	const replies = [
		{
			id: pinned,
			kind: 'question',
			policy: 'ordinary',
			delivery: { id: 'door-a' },
		},
		{
			id: pinned,
			kind: 'question',
			policy: 'ordinary',
			delivery: { id: 'door-b' },
			result: answered,
		},
	] as const
	let index = 0
	const dialog = new BrokerDialog(request, async () => {
		const reply = replies[index]
		index += 1
		return reply
	})
	await dialog.open()
	await assert.rejects(dialog.perform('get'), /registered request/)
})

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
