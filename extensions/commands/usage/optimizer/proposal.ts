import {
	eligibleProposalActions,
	validateModelResponse,
} from './validate-response.ts'

import type { Proposal } from './validate-response.ts'

const ZERO = 0
const REPORT_INDENT = 2

export const NATIVE_MODEL_ID = 'claude-fable-5-2'

export type ModelSelection = { selector: string; isVerified: boolean }
export type Fact = { id: string; value: number }
export type ModelAdapter = (input: {
	day: string
	model: string
	facts: Fact[]
	actions: readonly string[]
	tools: readonly []
}) => Promise<unknown>
export type ProposalReport = {
	day: string
	status: 'complete' | 'partial'
	missingHosts: string[]
	invalidHosts: string[]
	proposal: Proposal | null
	citedFacts: Fact[]
	missingInputs: string[]
}

export function exactModelId(selection: ModelSelection): string {
	if (!selection.isVerified || selection.selector !== NATIVE_MODEL_ID)
		throw new Error(
			'Model selector must be verified before proposal generation',
		)
	return selection.selector
}

export async function runProposal(input: {
	day: string
	roster: string[]
	receivedHosts: string[]
	invalidHosts: string[]
	facts: Fact[]
	selection: ModelSelection
	modelAdapter: ModelAdapter
}): Promise<ProposalReport> {
	const missingHosts = input.roster.filter(
		host =>
			!input.receivedHosts.includes(host) &&
			!input.invalidHosts.includes(host),
	)
	if (missingHosts.length > ZERO || input.invalidHosts.length > ZERO)
		return createProposalReport({
			...input,
			modelResponse: {},
			configuredModel: input.selection.selector,
		})
	const actions = eligibleProposalActions(input.facts)
	if (!actions.length)
		return {
			day: input.day,
			status: 'partial',
			missingHosts: [],
			invalidHosts: [],
			proposal: null,
			citedFacts: [],
			missingInputs: ['proposal_measurements_missing'],
		}
	const configuredModel = exactModelId(input.selection)
	const modelResponse = await input.modelAdapter({
		day: input.day,
		model: configuredModel,
		actions,
		tools: [],
		facts: input.facts.toSorted((left, right) =>
			left.id.localeCompare(right.id),
		),
	})
	return createProposalReport({ ...input, configuredModel, modelResponse })
}

export function createProposalReport(input: {
	day: string
	roster: string[]
	receivedHosts: string[]
	invalidHosts: string[]
	facts: Fact[]
	modelResponse: unknown
	configuredModel: string
}): ProposalReport {
	const missingHosts = input.roster
		.filter(
			host =>
				!input.receivedHosts.includes(host) &&
				!input.invalidHosts.includes(host),
		)
		.toSorted()
	const invalidHosts = input.invalidHosts.toSorted()
	const facts = input.facts.toSorted((left, right) =>
		left.id.localeCompare(right.id),
	)
	const proposal =
		missingHosts.length === ZERO && invalidHosts.length === ZERO
			? validateModelResponse(
					input.modelResponse,
					input.configuredModel,
					facts,
				)
			: null
	return {
		day: input.day,
		status:
			missingHosts.length > ZERO || invalidHosts.length > ZERO
				? 'partial'
				: 'complete',
		missingHosts,
		invalidHosts,
		proposal,
		citedFacts: facts.filter(fact =>
			proposal?.sourceFacts.includes(fact.id),
		),
		missingInputs: [
			...missingHosts.map(
				host => `usage_snapshot_missing:${host}:${input.day}`,
			),
			...invalidHosts.map(
				host => `usage_snapshot_invalid:${host}:${input.day}`,
			),
		],
	}
}

export function stableReportJson(report: ProposalReport): string {
	return `${JSON.stringify(report, null, REPORT_INDENT)}\n`
}
