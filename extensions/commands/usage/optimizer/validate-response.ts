import { Type } from 'typebox'
import { Value } from 'typebox/value'

const actions = {
	'input-budget': {
		title: 'Review input token budgets',
		change: 'Trial a smaller context budget on comparable sessions.',
		measure:
			'Compare median input tokens per turn before and after the trial. Track incomplete tasks as a guardrail.',
	},
	'routing-latency': {
		title: 'Review routing latency',
		change: 'Review the slowest routing step and trial a shorter path on equivalent tasks.',
		measure:
			'Compare routing milliseconds per measured event before and after the trial. Track failure rates as a guardrail.',
	},
	'failure-review': {
		title: 'Review failed requests',
		change: 'Review where requests fail and trial one reliability change on comparable tasks.',
		measure:
			'Compare failed requests per hundred events before and after the trial. Track elapsed time as a guardrail.',
	},
} as const

export const proposalActions = Object.keys(actions).filter(
	(action): action is keyof typeof actions => Object.hasOwn(actions, action),
)

export const proposalChoiceSchema = Type.Object(
	{
		action: Type.String({ enum: proposalActions }),
		sourceFacts: Type.Array(Type.String({ minLength: 1 }), {
			minItems: 1,
		}),
	},
	{ additionalProperties: false },
)

const responseSchema = Type.Object(
	{
		metadata: Type.Object(
			{ model: Type.String({ minLength: 1 }) },
			{ additionalProperties: false },
		),
		proposal: proposalChoiceSchema,
	},
	{ additionalProperties: false },
)

export type Proposal = {
	title: string
	change: string
	measure: string
	sourceFacts: string[]
}

export function validateModelResponse(
	candidate: unknown,
	expectedModel: string,
): Proposal {
	if (!Value.Check(responseSchema, candidate))
		throw new Error(
			'Expected structured model response with exact proposal fields',
		)
	if (candidate.metadata.model !== expectedModel)
		throw new Error(
			'Structured response model does not match configured model',
		)
	const { action, sourceFacts } = candidate.proposal
	if (new Set(sourceFacts).size !== sourceFacts.length)
		throw new Error('Expected unique proposal citations')
	const approvedAction = proposalActions.find(allowed => allowed === action)
	if (!approvedAction) throw new Error('Expected a reviewed proposal action')
	return { ...actions[approvedAction], sourceFacts: sourceFacts.toSorted() }
}
