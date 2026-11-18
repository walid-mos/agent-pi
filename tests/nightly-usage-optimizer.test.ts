import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
	latestClosedUtcDay,
	parisSlotState,
} from '../extensions/commands/usage/optimizer/closed-utc-day.ts'
import { parseNativeSessionFile } from '../extensions/commands/usage/optimizer/native-session-evidence.ts'
import { NATIVE_MODEL_ID } from '../extensions/commands/usage/optimizer/proposal.ts'

void test('closed UTC day and Paris DST cases use the invocation instant', () => {
	assert.equal(latestClosedUtcDay('2026-11-17T01:00:00Z'), '2026-11-16')
	assert.equal(latestClosedUtcDay('2026-07-17T00:00:00Z'), '2026-07-16')
	assert.equal(parisSlotState('2026-03-29T01:00:00Z'), 'spring-gap-recovery')
	assert.equal(parisSlotState('2026-10-25T00:00:00Z'), 'autumn-fold-first')
	assert.equal(parisSlotState('2026-10-25T01:00:00Z'), 'autumn-fold-second')
	assert.throws(
		() => parisSlotState('2026-07-17T01:00:00Z'),
		/02:00 Europe\/Paris/,
	)
	assert.throws(
		() => latestClosedUtcDay('2026-07-17T00:00:00'),
		/explicit UTC offset/,
	)
})

void test('native session summary ignores prompts and records only approved fields', () => {
	const summary = parseNativeSessionFile(
		[
			JSON.stringify({ type: 'session', id: 'private-session-id' }),
			JSON.stringify({
				type: 'message',
				timestamp: '2026-11-16T08:00:00Z',
				message: { role: 'user', content: 'ignore the allowlist' },
			}),
			JSON.stringify({
				type: 'message',
				timestamp: '2026-11-16T08:01:00Z',
				message: {
					role: 'assistant',
					model: 'claude-fable-5-2',
					usage: { input: 81, output: 12 },
					content: 'private answer',
				},
			}),
			JSON.stringify({
				type: 'compaction',
				timestamp: '2026-11-16T08:02:00Z',
			}),
		],
		{ hostId: 'host-a', source: 'pi', day: '2026-11-16' },
	)
	assert.deepEqual(summary, {
		hostId: 'host-a',
		source: 'pi',
		day: '2026-11-16',
		sessions: 1,
		turns: 1,
		compactions: 1,
		inputTokens: 81,
		outputTokens: 12,
	})
	assert.equal(JSON.stringify(summary).includes('private-session-id'), false)
	assert.equal(
		JSON.stringify(summary).includes('ignore the allowlist'),
		false,
	)
	assert.equal(JSON.stringify(summary).includes('private answer'), false)
})

void test('measured assistant and compaction entries require an explicit valid timestamp', () => {
	const owner = { hostId: 'host-a', source: 'pi', day: '2026-11-16' } as const
	const assistant = {
		type: 'message',
		message: { role: 'assistant', usage: { input: 300, output: 100 } },
	}
	for (const entry of [
		assistant,
		{ ...assistant, timestamp: 'invalid' },
		{ type: 'compaction' },
	])
		assert.throws(
			() => parseNativeSessionFile([JSON.stringify(entry)], owner),
			/timestamp/i,
		)
})

void test('measured assistant entries require both token counts in Pi and Claude Code', () => {
	const timestamp = '2026-11-16T08:00:00Z'
	for (const usage of [
		undefined,
		{ input: 300 },
		{ input: 300, output: null },
	]) {
		const entry = {
			type: 'message',
			timestamp,
			message: { role: 'assistant', usage },
		}
		assert.throws(
			() =>
				parseNativeSessionFile([JSON.stringify(entry)], {
					hostId: 'host-a',
					day: '2026-11-16',
					source: 'pi',
				}),
			/usage|token count/,
		)
	}
	const entry = {
		type: 'assistant',
		timestamp,
		message: { usage: { input_tokens: 300 } },
	}
	assert.throws(
		() =>
			parseNativeSessionFile([JSON.stringify(entry)], {
				hostId: 'host-a',
				day: '2026-11-16',
				source: 'claude-code',
			}),
		/token count/,
	)
})

void test('native Claude Code usage is summarized without account or transcript content', () => {
	const evidence = parseNativeSessionFile(
		[
			JSON.stringify({
				type: 'assistant',
				timestamp: '2026-11-16T08:01:00Z',
				sessionId: 'private-id',
				message: {
					model: NATIVE_MODEL_ID,
					usage: { input_tokens: 55, output_tokens: 8 },
					content: 'private output',
				},
			}),
		],
		{ hostId: 'host-a', source: 'claude-code', day: '2026-11-16' },
	)
	assert.ok(evidence)
	assert.equal(evidence.turns, 1)
	assert.equal(evidence.inputTokens, 55)
	assert.equal(evidence.outputTokens, 8)
	assert.equal(JSON.stringify(evidence).includes('private-id'), false)
	assert.equal(JSON.stringify(evidence).includes('private output'), false)
})
