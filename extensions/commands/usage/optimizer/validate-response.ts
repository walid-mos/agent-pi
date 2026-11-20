import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Fact } from './proposal.ts'

type RequiredFact = { metric: string; measurement: 'positive' | 'zero' }

const actions = {
	'input-budget': {
		title: 'Review input token budgets',
		change: 'Trial a smaller context budget on comparable sessions.',
		measure:
			'Compare input tokens per turn before and after the trial. Track incomplete tasks as a guardrail.',
		groups: ['pi', 'claude-code'],
		required: [
			{ metric: 'inputTokens', measurement: 'positive' },
			{ metric: 'turns', measurement: 'positive' },
		],
	},
	'routing-latency': {
		title: 'Review routing latency',
		change: 'Review the slowest routing step and trial a shorter path on equivalent tasks.',
		measure:
			'Compare routing milliseconds per measured event before and after the trial. Track failure rates as a guardrail.',
		groups: ['routing-overhead'],
		required: [
			{ metric: 'durationMs.sum', measurement: 'positive' },
			{ metric: 'durationMs.missing', measurement: 'zero' },
			{ metric: 'events', measurement: 'positive' },
		],
	},
	'failure-review': {
		title: 'Review failed requests',
		change: 'Review where requests fail and trial one reliability change on comparable tasks.',
		measure:
			'Compare recorded failures per hundred workload events before and after the trial. Track elapsed time as a guardrail.',
		groups: ['workload'],
		required: [
			{ metric: 'failed', measurement: 'positive' },
			{ metric: 'events', measurement: 'positive' },
		],
	},
} as const

export const proposalActions = Object.keys(actions).filter(
	(action): action is keyof typeof actions => Object.hasOwn(actions, action),
)

export const proposalEvidenceRules = proposalActions
	.map(action => {
		const { groups, required } = actions[action]
		const metrics = required
			.map(({ metric, measurement }) => `${metric} (${measurement})`)
			.join(', ')
		return `${action}: ${groups.join(' or ')} facts ${metrics}.`
	})
	.join(' ')

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
	facts: Fact[],
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
	const cited = sourceFacts.map(id => {
		const fact = facts.find(approved => approved.id === id)
		if (!fact)
			throw new Error(
				'Proposal cites a fact absent from the approved input',
			)
		return fact
	})
	const { title, change, measure, groups, required } = actions[approvedAction]
	if (
		cited.length !== required.length ||
		!hasMatchingGroup(cited, groups, required)
	)
		throw new Error(
			'Proposal must cite matching measured facts for its action',
		)
	return { title, change, measure, sourceFacts: sourceFacts.toSorted() }
}

function hasMatchingGroup(
	facts: Fact[],
	groups: readonly string[],
	required: readonly RequiredFact[],
): boolean {
	const prefixes = new Set(
		facts.map(fact => {
			const [host, group] = fact.id.split('.')
			return `${host}.${group}`
		}),
	)
	return [...prefixes].some(
		prefix =>
			groups.some(group => prefix.endsWith(`.${group}`)) &&
			required.every(rule => {
				const fact = facts.find(
					candidate => candidate.id === `${prefix}.${rule.metric}`,
				)
				return (
					fact &&
					Number.isFinite(fact.value) &&
					(rule.measurement === 'zero'
						? fact.value === 0
						: fact.value > 0)
				)
			}),
	)
}

export function eligibleProposalActions(
	facts: Fact[],
): (keyof typeof actions)[] {
	return proposalActions.filter(action => {
		const { groups, required } = actions[action]
		return hasMatchingGroup(facts, groups, required)
	})
}
