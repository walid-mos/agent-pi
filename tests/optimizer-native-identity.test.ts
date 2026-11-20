import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseNativeSessionFile } from '../extensions/commands/usage/optimizer/native-session-evidence.ts'

const day = '2025-10-25'
const owner = { hostId: 'host-a', source: 'claude-code', day } as const
const assistant = {
	type: 'assistant',
	sessionId: 'native-session',
	uuid: 'block-one',
	requestId: 'req_1',
	timestamp: `${day}T02:00:00Z`,
	message: {
		id: 'msg_1',
		role: 'assistant',
		usage: { input_tokens: 19, output_tokens: 23 },
	},
}

function parse(entries: unknown[]): ReturnType<typeof parseNativeSessionFile> {
	return parseNativeSessionFile(
		entries.map(entry => JSON.stringify(entry)),
		owner,
	)
}

void test('Claude Code assistant measurements require a matching nested assistant role', () => {
	for (const role of ['user', undefined])
		assert.throws(
			() =>
				parse([
					{ ...assistant, message: { ...assistant.message, role } },
				]),
			/role/,
		)
})

void test('Claude Code blocks with one message ID use the largest cumulative output once', () => {
	const finalBlock = {
		...assistant,
		uuid: 'block-two',
		message: {
			...assistant.message,
			usage: { input_tokens: 19, output_tokens: 31 },
		},
	}
	const repeatedBlock = { ...finalBlock, uuid: 'block-three' }
	const entries = [assistant, finalBlock, repeatedBlock]
	const expected = {
		...owner,
		sessions: 1,
		turns: 1,
		compactions: 0,
		inputTokens: 19,
		outputTokens: 31,
	}
	assert.deepEqual(parse(entries), expected)
	assert.deepEqual(parse(entries.toReversed()), expected)
})

void test('Claude Code counts exact transcript copies once and accepts distinct responses', () => {
	const secondResponse = {
		...assistant,
		uuid: 'block-two',
		requestId: 'req_2',
		message: { ...assistant.message, id: 'msg_2' },
	}
	const evidence = parse([assistant, secondResponse, assistant])
	const reusedRequest = { ...secondResponse, requestId: assistant.requestId }
	assert.throws(
		() => parse([assistant, reusedRequest]),
		/request and response/,
	)
	assert.throws(
		() => parse([reusedRequest, assistant]),
		/request and response/,
	)
	assert.deepEqual(evidence, {
		...owner,
		sessions: 1,
		turns: 2,
		compactions: 0,
		inputTokens: 38,
		outputTokens: 46,
	})
})

void test('Claude Code requires UUIDs and rejects changes to a UUID measurement', () => {
	assert.throws(() => parse([{ ...assistant, uuid: '' }]), /transcript UUID/)
	const conflicts = [
		{ timestamp: `${day}T03:00:00Z` },
		{
			message: {
				...assistant.message,
				usage: { input_tokens: 19, output_tokens: 31 },
			},
		},
		{ requestId: undefined },
	]
	for (const conflict of conflicts) {
		const repeated = { ...assistant, ...conflict }
		assert.throws(() => parse([assistant, repeated]), /transcript UUID/)
		assert.throws(() => parse([repeated, assistant]), /transcript UUID/)
	}
})

void test('Claude Code refuses inconsistent input counts, request identities, dates and session identities for repeated responses', () => {
	const conflicts = [
		{
			message: {
				...assistant.message,
				usage: { input_tokens: 20, output_tokens: 23 },
			},
		},
		{ requestId: 'req_conflict' },
		{ timestamp: '2025-10-24T23:59:59Z' },
		{ sessionId: 'different-session' },
	]
	for (const conflict of conflicts) {
		const repeated = { ...assistant, uuid: 'block-two', ...conflict }
		assert.throws(() => parse([assistant, repeated]), /conflict|identity/)
		assert.throws(() => parse([repeated, assistant]), /conflict|identity/)
	}
})
