import { brokerQuestions } from './broker-questionnaire.ts'
import { normalizeQuestions } from './questionnaire-normalization.ts'

import type { Static } from 'typebox'
import type { BrokerDialog } from '#lib/human-dialog/broker.ts'
import type { configuredBroker } from '#lib/human-dialog/config.ts'
import type { BrokerRequest } from '#lib/human-dialog/schema.ts'
import type { Question } from './questionnaire-model.ts'
import type { AskParams } from './schema.ts'

type Params = Static<typeof AskParams>

export function requestedQuestions(params: Params): Question[] {
	if (params.policy === 'push' && !params.scope?.trim())
		throw new Error('Push approval requires its exact immutable scope.')
	if (params.scope && params.policy !== 'push')
		throw new Error('Approval scope requires explicit policy=push.')
	const questions = normalizeQuestions(params.questions)
	const [first] = questions
	if (params.policy === 'push' && first)
		first.prompt = `Approval scope: ${params.scope}\n\n${first.prompt}`
	return questions
}

export function questionnaireBroker(
	params: Params,
	questions: Question[],
	createBroker: ReturnType<typeof configuredBroker>,
): BrokerDialog | undefined {
	if (!createBroker) return undefined
	const request: Omit<
		Extract<BrokerRequest, { kind: 'question' }>,
		'source'
	> = {
		kind: 'question',
		policy: params.policy ?? 'ordinary',
		context: params.context ?? '',
		questions: brokerQuestions(questions),
	}
	if (params.scope) request.scope = params.scope
	return createBroker(request)
}
