import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bindCompletion } from '../extensions/lib/human-dialog/completion.ts'
import { checkedReceipt } from '../extensions/lib/human-dialog/receipt.ts'
import {
	brokerQuestionnaire,
	brokerQuestions,
} from '../extensions/ui/ask-user-question/broker-questionnaire.ts'
import { normalizeQuestions } from '../extensions/ui/ask-user-question/questionnaire-normalization.ts'
import { requestedQuestions } from '../extensions/ui/ask-user-question/questionnaire-request.ts'
import { restoreQuestionnaireDrafts } from '../extensions/ui/ask-user-question/questionnaire-session.ts'

import {
	QuestionBrokerFixture,
	questions,
	request,
} from './fixtures/human-broker.ts'

import type { DialogCompletion } from '../extensions/lib/human-dialog/completion.ts'
import type { AskResult } from '../extensions/ui/ask-user-question/questionnaire-model.ts'

function controller(
	completion: DialogCompletion<AskResult>,
	typed?: AskResult,
): Promise<AskResult> {
	return new Promise((resolve, reject) => {
		const submit = bindCompletion(completion, outcome => {
			if (outcome.ok) resolve(outcome.value)
			else reject(outcome.error)
		})
		if (typed) submit(typed)
	})
}

const typed: AskResult = {
	questions,
	cancelled: false,
	answers: [
		{
			kind: 'single',
			id: 'target',
			label: 'Preview',
			value: 'preview-id',
			index: 1,
			wasCustom: false,
		},
		{
			kind: 'multi',
			id: 'checks',
			label: 'Build, More',
			value: 'build-id,More',
			wasCustom: false,
			labels: ['Build', 'More'],
			optionValues: ['build-id'],
			customText: 'More',
		},
		{
			kind: 'single',
			id: 'notes',
			label: 'Local note',
			value: 'Local note',
			wasCustom: true,
		},
	],
}

test('Discord closes the actual dialog completion controller and maps reordered answers to Pi values', async () => {
	const fixture = new QuestionBrokerFixture()
	const pending = brokerQuestionnaire(
		fixture.dialog,
		questions,
		controller,
		undefined,
	)
	await fixture.pendingGet.promise
	fixture.commitDiscord()
	const outcome = await pending
	assert.deepEqual(
		outcome.answers.map(answer => answer.value),
		['prod-id', 'types-id,build-id,Run audit too', 'Ship tomorrow'],
	)
	assert.equal(outcome.broker?.result?.origin, 'discord')
	assert.equal(fixture.operations.includes('answer'), false)
	assert.equal(outcome.cancelled, false)
})

test('a terminal submission racing after Discord receives the Discord winner rather than its local draft', async () => {
	const fixture = new QuestionBrokerFixture()
	const pending = brokerQuestionnaire(
		fixture.dialog,
		questions,
		completion => {
			fixture.commitDiscord()
			return controller(completion, typed)
		},
		undefined,
	)
	const outcome = await pending
	assert.equal(outcome.answers[0]?.value, 'prod-id')
	assert.equal(outcome.broker?.result?.origin, 'discord')
	assert.ok(fixture.operations.includes('answer'))
})

test('a committed terminal answer survives a late Discord answer', async () => {
	const fixture = new QuestionBrokerFixture()
	const outcome = await brokerQuestionnaire(
		fixture.dialog,
		questions,
		completion => controller(completion, typed),
		undefined,
	)
	fixture.commitDiscord()
	assert.deepEqual(outcome.answers, typed.answers)
	assert.equal(fixture.receipt().result?.origin, 'terminal')
})

test('Discuss pauses the broker and preserves drafts while a new call gets a different source', async () => {
	const fixture = new QuestionBrokerFixture()
	const [question] = questions
	assert.ok(question)
	const chat = {
		question,
		initialState: {
			answers: [typed.answers[0]].filter(answer => !!answer),
			drafts: { checks: 'Keep this draft' },
		},
	}
	const outcome = await brokerQuestionnaire(
		fixture.dialog,
		questions,
		completion =>
			controller(completion, {
				questions,
				answers: [],
				cancelled: false,
				chat,
			}),
		undefined,
	)
	assert.deepEqual(outcome.chat, chat)
	assert.equal(outcome.broker?.result?.status, 'paused')
	const restored = restoreQuestionnaireDrafts([
		{
			type: 'message',
			message: {
				role: 'toolResult',
				toolName: 'ask_user_question',
				details: outcome,
				isError: false,
			},
		},
	])
	assert.deepEqual([...restored.values()], [chat.initialState])
	assert.throws(
		() =>
			checkedReceipt(fixture.receipt(), {
				...request,
				source: { ...request.source, call: 'resumed-call' },
			}),
		/does not match/,
	)
})

test('cancellation discards answered drafts and never grants consent', async () => {
	const fixture = new QuestionBrokerFixture()
	const outcome = await brokerQuestionnaire(
		fixture.dialog,
		questions,
		completion => controller(completion, { ...typed, cancelled: true }),
		undefined,
	)
	assert.deepEqual(outcome.answers, [])
	assert.equal(outcome.cancelled, true)
	assert.equal(outcome.broker?.result?.status, 'cancelled')
})

test('restart reopens the same source and returns its durable winner without another local dialog', async () => {
	const fixture = new QuestionBrokerFixture()
	fixture.commitDiscord()
	const outcome = await brokerQuestionnaire(
		fixture.dialog,
		questions,
		async () => {
			throw new Error('must not reopen')
		},
		undefined,
	)
	assert.equal(outcome.answers[0]?.value, 'prod-id')
})

test('rejects duplicate display labels instead of mapping a Discord choice to an arbitrary value', () => {
	assert.throws(
		() =>
			brokerQuestions(
				normalizeQuestions([
					{
						id: 'duplicate',
						prompt: 'Choose',
						options: [
							{ label: 'Same', value: 'first' },
							{ label: 'Same', value: 'second' },
						],
					},
				]),
			),
		/distinct single-line/,
	)
})

test('only explicit push policy requires scope and displays it to the terminal', () => {
	const raw = [
		{
			id: 'push',
			prompt: 'Push now?',
			options: [{ label: 'Approve push' }],
		},
	]
	assert.equal(requestedQuestions({ questions: raw })[0]?.prompt, 'Push now?')
	assert.throws(
		() => requestedQuestions({ questions: raw, policy: 'push' }),
		/exact immutable scope/,
	)
	assert.equal(
		requestedQuestions({
			questions: raw,
			policy: 'push',
			scope: 'branch to origin commit FULL_SHA',
		})[0]?.prompt,
		'Approval scope: branch to origin commit FULL_SHA\n\nPush now?',
	)
})

test('rejects altered digest, request, unknown labels, duplicate IDs and incomplete click evidence', () => {
	const fixture = new QuestionBrokerFixture()
	fixture.commitDiscord()
	const receipt = fixture.receipt()
	const accepted = receipt.result
	assert.ok(accepted?.status === 'answered')
	for (const changed of [
		{ ...accepted, digest: 'altered' },
		{ ...accepted, request: 'other-request' },
		{ ...accepted, evidence: { clicks: [] } },
		{
			...accepted,
			answers: [
				{ id: 'target', labels: ['unknown'], text: '' },
				...accepted.answers.slice(1),
			],
		},
		{
			...accepted,
			answers: [
				accepted.answers[0],
				accepted.answers[0],
				accepted.answers[0],
			],
		},
	])
		assert.throws(() =>
			checkedReceipt({ ...receipt, result: changed }, request),
		)
})
