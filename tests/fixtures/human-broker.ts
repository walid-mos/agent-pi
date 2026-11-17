import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { BrokerDialog } from '../../extensions/lib/human-dialog/broker.ts'
import {
	dialogId,
	questionDigest,
} from '../../extensions/lib/human-dialog/receipt.ts'
import { BrokerAnswerSchema } from '../../extensions/lib/human-dialog/schema.ts'
import { brokerQuestions } from '../../extensions/ui/ask-user-question/broker-questionnaire.ts'
import { normalizeQuestions } from '../../extensions/ui/ask-user-question/questionnaire-normalization.ts'

import type {
	BrokerAnswer,
	BrokerReceipt,
	BrokerRequest,
} from '../../extensions/lib/human-dialog/schema.ts'
import type { BrokerOperation } from '../../extensions/lib/human-dialog/transport.ts'

export const source = {
	type: 'worker',
	worker: 'fixture',
	session: '/sessions/fixture.jsonl',
	call: 'call-1',
} as const
export const questions = normalizeQuestions([
	{
		id: 'target',
		prompt: 'Where?',
		options: [
			{ label: 'Preview', value: 'preview-id' },
			{ label: 'Production', value: 'prod-id' },
		],
	},
	{
		id: 'checks',
		prompt: 'Which checks?',
		multiSelect: true,
		options: [
			{ label: 'Build', value: 'build-id' },
			{ label: 'Types', value: 'types-id' },
		],
	},
	{ id: 'notes', prompt: 'Anything else?' },
])
export const request = {
	kind: 'question',
	source,
	policy: 'ordinary',
	context: 'Choose',
	questions: brokerQuestions(questions),
} satisfies BrokerRequest
const externalAnswers: BrokerAnswer[] = [
	{ id: 'notes', labels: [], text: 'Ship tomorrow' },
	{ id: 'target', labels: ['Production'], text: '' },
	{ id: 'checks', labels: ['Types', 'Build'], text: 'Run audit too' },
]

export class QuestionBrokerFixture {
	readonly operations: BrokerOperation[] = []
	readonly pendingGet = Promise.withResolvers<void>()
	readonly changed = Promise.withResolvers<void>()
	private outcome: BrokerReceipt['result']
	readonly dialog = new BrokerDialog(
		request,
		async (operation, _id, input) => {
			this.operations.push(operation)
			if (operation === 'get' && !this.outcome) {
				this.pendingGet.resolve()
				await this.changed.promise
			}
			if (operation === 'pause' || operation === 'cancel')
				this.outcome ??= {
					status: operation === 'pause' ? 'paused' : 'cancelled',
					origin: 'terminal',
					at: 1,
				}
			if (operation === 'answer') this.commitTerminal(input)
			if (this.outcome) this.changed.resolve()
			return this.receipt()
		},
	)

	receipt(): BrokerReceipt {
		const receipt: BrokerReceipt = {
			id: dialogId(request),
			kind: 'question',
			policy: 'ordinary',
			delivery: { id: 'fixture-door' },
		}
		if (this.outcome) receipt.result = this.outcome
		return receipt
	}

	commitDiscord(): void {
		this.outcome ??= {
			status: 'answered',
			origin: 'discord',
			at: 1,
			dialog: dialogId(request),
			digest: questionDigest(request),
			request: 'fixture-door',
			answers: externalAnswers,
			evidence: {
				clicks: questions.map((question, index) => ({
					question: question.id,
					userId: '10000000000000001',
					guildId: '20000000000000002',
					messageUrl: `https://discord.com/channels/20000000000000002/30000000000000003/4000000000000000${index}`,
					at: '2026-11-01T00:00:00.000Z',
				})),
			},
		}
		this.changed.resolve()
	}

	private commitTerminal(input: unknown): void {
		if (!input || typeof input !== 'object')
			throw new Error('Missing terminal answers')
		const answers: unknown = Reflect.get(input, 'answers')
		if (!Value.Check(Type.Array(BrokerAnswerSchema), answers))
			throw new Error('Missing answers')
		this.outcome ??= {
			status: 'answered',
			origin: 'terminal',
			at: 1,
			dialog: dialogId(request),
			digest: questionDigest(request),
			answers,
		}
	}
}
