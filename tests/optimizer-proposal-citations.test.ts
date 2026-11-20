import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
	createProposalReport,
	NATIVE_MODEL_ID,
	runProposal,
} from '../extensions/commands/usage/optimizer/proposal.ts'

const host = 'a'.repeat(32)
const otherHost = 'b'.repeat(32)
const routing = `${host}.routing-overhead`
const duration = `${routing}.durationMs.sum`
const missingDuration = `${routing}.durationMs.missing`
const events = `${routing}.events`
const foreignEvents = `${otherHost}.routing-overhead.events`
const compactions = `${host}.pi.compactions`
const facts = [
	{ id: duration, value: 120 },
	{ id: missingDuration, value: 0 },
	{ id: events, value: 4 },
	{ id: foreignEvents, value: 3 },
	{ id: compactions, value: 0 },
]

function report(
	sourceFacts: string[],
	measurements = facts,
	action = 'routing-latency',
): ReturnType<typeof createProposalReport> {
	return createProposalReport({
		day: '2026-10-24',
		roster: [host],
		receivedHosts: [host],
		invalidHosts: [],
		facts: measurements,
		configuredModel: NATIVE_MODEL_ID,
		modelResponse: {
			metadata: { model: NATIVE_MODEL_ID },
			proposal: { action, sourceFacts },
		},
	})
}

void test('routing latency rejects a real but unrelated citation and incomplete or mixed-host evidence', () => {
	for (const citations of [
		[compactions],
		[duration],
		[duration, foreignEvents, missingDuration],
		[duration, events, missingDuration, compactions],
	])
		assert.throws(() => report(citations), /matching measured facts/)
	assert.match(
		report([duration, missingDuration, events]).proposal?.measure ?? '',
		/routing milliseconds/,
	)
})

void test('input budgeting and failure review require their own positive measurements and denominators', () => {
	const native = [
		{ id: `${host}.pi.inputTokens`, value: 90 },
		{ id: `${host}.pi.turns`, value: 3 },
	]
	const workload = [
		{ id: `${host}.workload.failed`, value: 2 },
		{ id: `${host}.workload.events`, value: 5 },
	]
	for (const [action, measurements, measure] of [
		['input-budget', native, /input tokens per turn/],
		['failure-review', workload, /failures per hundred workload events/],
	] as const) {
		const ids = measurements.map(fact => fact.id)
		assert.match(
			report(ids, measurements, action).proposal?.measure ?? '',
			measure,
		)
		assert.throws(
			() => report(ids.slice(0, 1), measurements, action),
			/matching measured facts/,
		)
		const zero = measurements.map(({ id }) => ({ id, value: 0 }))
		assert.throws(
			() => report(ids, zero, action),
			/matching measured facts/,
		)
	}
})

void test('complete host coverage without eligible measurements skips the model', async () => {
	const partial = await runProposal({
		day: '2026-10-24',
		roster: [host],
		receivedHosts: [host],
		invalidHosts: [],
		facts: [{ id: compactions, value: 0 }],
		selection: { selector: NATIVE_MODEL_ID, isVerified: true },
		modelAdapter: async () =>
			assert.fail('No eligible action may reach the model'),
	})
	assert.deepEqual(
		{ status: partial.status, missingInputs: partial.missingInputs },
		{ status: 'partial', missingInputs: ['proposal_measurements_missing'] },
	)
})

void test('routing latency rejects partially measured durations even when all required IDs are cited', () => {
	const incomplete = facts.map(fact =>
		fact.id === missingDuration ? { id: missingDuration, value: 1 } : fact,
	)
	assert.throws(
		() => report([duration, missingDuration, events], incomplete),
		/matching measured facts/,
	)
})
