import { createHash } from 'node:crypto'

import { Value } from 'typebox/value'

import { BrokerReceiptSchema } from './schema.ts'

import type {
	BrokerAnswer,
	BrokerQuestion,
	BrokerReceipt,
	BrokerRequest,
	BrokerResult,
	BrokerTarget,
	QuestionDialog,
} from './schema.ts'

type QuestionRequest = BrokerRequest & QuestionDialog
type Answered = Extract<BrokerResult, { status: 'answered' }>
const ID_LENGTH = 32

export function dialogId(request: Pick<BrokerRequest, 'source'>): string {
	return createHash('sha256')
		.update(JSON.stringify(request.source))
		.digest('hex')
		.slice(0, ID_LENGTH)
}

export function questionDigest(request: QuestionRequest): string {
	return createHash('sha256')
		.update(
			JSON.stringify({
				dialog: dialogId(request),
				questions: request.questions,
				policy: request.policy,
				scope: request.scope,
				context: request.context,
			}),
		)
		.digest('hex')
}

export function checkedReceipt(
	raw: unknown,
	request: BrokerRequest,
	deliveryId?: string,
): BrokerReceipt {
	if (!Value.Check(BrokerReceiptSchema, raw))
		throw new Error(
			'Human dialog broker returned an invalid metadata receipt.',
		)
	const policy = request.kind === 'question' ? request.policy : 'local'
	if (
		raw.id !== dialogId(request) ||
		raw.kind !== request.kind ||
		raw.policy !== policy
	)
		throw new Error(
			'Human dialog broker receipt does not match this tool call.',
		)
	const observed = raw.delivery?.id
	if (observed && deliveryId && observed !== deliveryId)
		throw new Error(
			'Human dialog broker changed the registered request of this dialog. Open a new call.',
		)
	const registered = deliveryId ?? observed
	checkResult(raw, request, registered)
	const receipt: BrokerReceipt = {
		id: raw.id,
		kind: raw.kind,
		policy: raw.policy,
	}
	if (raw.result) receipt.result = raw.result
	if (raw.delivery) receipt.delivery = { id: raw.delivery.id }
	return receipt
}

function checkResult(
	receipt: BrokerReceipt,
	request: BrokerRequest,
	deliveryId: string | undefined,
): void {
	const { result: outcome } = receipt
	if (!outcome) return
	if (outcome.status === 'stored') {
		if (request.kind !== 'secret')
			throw new Error(
				'Human dialog broker returned a secret receipt for a question.',
			)
		return checkSecretTarget(
			outcome,
			request.target,
			receipt.id,
			deliveryId,
		)
	}
	if (outcome.status === 'answered')
		checkQuestionResult(outcome, request, receipt.id, deliveryId)
}

function checkQuestionResult(
	outcome: Answered,
	request: BrokerRequest,
	dialog: string,
	deliveryId: string | undefined,
): void {
	if (
		request.kind !== 'question' ||
		outcome.dialog !== dialog ||
		outcome.digest !== questionDigest(request) ||
		outcome.scope !== request.scope
	)
		throw new Error(
			'Human dialog answer does not match its question digest and scope.',
		)
	checkAnswers(request, outcome.answers)
	if (outcome.origin === 'discord') {
		if (!deliveryId || outcome.request !== deliveryId)
			throw new Error(
				'Discord answer does not match its registered broker request.',
			)
		checkEvidence(request, outcome)
	}
}

function checkSecretTarget(
	outcome: Extract<BrokerResult, { status: 'stored' }>,
	target: BrokerTarget,
	dialog: string,
	deliveryId: string | undefined,
): void {
	if (
		outcome.dialog !== dialog ||
		(Boolean(deliveryId) && outcome.request !== deliveryId)
	)
		throw new Error(
			'Secret receipt does not match this dialog and its registered request. Open a new call.',
		)
	if (target.destination === 'browser')
		return checkBrowserTarget(outcome, target.origin)
	if (outcome.target || outcome.handoff)
		throw new Error(
			'Vault receipt unexpectedly contains a browser handoff. Open a new call.',
		)
}

function checkBrowserTarget(
	outcome: Extract<BrokerResult, { status: 'stored' }>,
	origin: string,
): void {
	if (
		outcome.target?.destination !== 'browser' ||
		outcome.target.origin !== origin ||
		!outcome.handoff
	)
		throw new Error(
			'Browser receipt does not match its declared destination and origin. Open a new call.',
		)
}

function checkAnswers(
	request: QuestionRequest,
	answers: Answered['answers'],
): void {
	if (answers.length !== request.questions.length)
		throw new Error(
			'Human dialog broker must answer every question exactly once.',
		)
	for (const question of request.questions) {
		const matches = answers.filter(answer => answer.id === question.id)
		const [answer] = matches
		if (matches.length !== 1 || !answer)
			throw new Error(
				'Human dialog broker returned duplicate or missing question IDs.',
			)
		checkSelection(question, answer)
	}
}

function checkSelection(question: BrokerQuestion, answer: BrokerAnswer): void {
	const count = answer.labels.length + (answer.text.trim() ? 1 : 0)
	if (
		!count ||
		(!question.multiple && count !== 1) ||
		new Set(answer.labels).size !== answer.labels.length ||
		answer.labels.some(
			label => !question.options.some(option => option.label === label),
		)
	)
		throw new Error(
			'Human dialog broker returned unknown labels or an invalid selection count.',
		)
}

function checkEvidence(request: QuestionRequest, outcome: Answered): void {
	const clicks = outcome.evidence?.clicks ?? []
	if (clicks.length !== request.questions.length)
		throw new Error('Discord answer has no complete click evidence.')
	for (const question of request.questions)
		checkQuestionClick(question, clicks)
	if (new Set(clicks.map(click => click.messageUrl)).size !== clicks.length)
		throw new Error(
			'Discord answer reused a message for different questions.',
		)
}

function checkQuestionClick(
	question: BrokerQuestion,
	clicks: NonNullable<Answered['evidence']>['clicks'],
): void {
	const matches = clicks.filter(click => click.question === question.id)
	const [click] = matches
	if (
		matches.length !== 1 ||
		!click ||
		!Number.isFinite(Date.parse(click.at)) ||
		!click.messageUrl.startsWith(
			`https://discord.com/channels/${click.guildId}/`,
		)
	)
		throw new Error(
			'Discord answer has invalid question-bound click evidence.',
		)
}
