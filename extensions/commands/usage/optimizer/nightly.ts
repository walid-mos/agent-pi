import { Type } from 'typebox'
import { Value } from 'typebox/value'

import {
	latestClosedUtcDay,
	parisSlotState,
	timestampOf,
} from './closed-utc-day.ts'
import { readDailyFacts, USAGE_CONTRACT_REVISION } from './daily-usage.ts'
import { runProposal } from './proposal.ts'

import type { DailyUsageContract } from './daily-usage.ts'
import type {
	Fact,
	ModelAdapter,
	ModelSelection,
	ProposalReport,
} from './proposal.ts'

const hostIdSchema = Type.String({ pattern: '^[a-f0-9]{32}$' })
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const sessionSchema = Type.Object(
	{
		hostId: hostIdSchema,
		day: Type.String(),
		source: Type.Union([Type.Literal('pi'), Type.Literal('claude-code')]),
		sessions: count,
		turns: count,
		compactions: count,
		inputTokens: count,
		outputTokens: count,
	},
	{ additionalProperties: false },
)

type HostInput = {
	hostId: string
	snapshot?: unknown
	approvedSources: readonly ('pi' | 'claude-code')[]
	sessions: readonly unknown[]
}

type HostCoverage = {
	hostId: string
	usage: 'valid' | 'missing' | 'invalid'
	sessions: 'valid' | 'missing' | 'invalid' | 'unapproved'
}

type HostEvidence = { coverage: HostCoverage; facts: Fact[] }

function usageEvidence(
	host: HostInput,
	contract: DailyUsageContract,
	day: string,
): Pick<HostCoverage, 'usage'> & { usageFacts: Fact[] } {
	if (!Object.hasOwn(host, 'snapshot'))
		return { usage: 'missing', usageFacts: [] }
	try {
		return {
			usage: 'valid',
			usageFacts: readDailyFacts(
				contract,
				host.snapshot,
				host.hostId,
				day,
			),
		}
	} catch {
		return { usage: 'invalid', usageFacts: [] }
	}
}

function sessionEvidence(
	host: HostInput,
	day: string,
): Pick<HostCoverage, 'sessions'> & { sessionFacts: Fact[] } {
	if (!host.approvedSources.length)
		return { sessions: 'unapproved', sessionFacts: [] }
	const seen = new Set<string>()
	const sessionFacts: Fact[] = []
	for (const summary of host.sessions) {
		if (
			!Value.Check(sessionSchema, summary) ||
			summary.hostId !== host.hostId ||
			summary.day !== day ||
			!host.approvedSources.includes(summary.source) ||
			seen.has(summary.source)
		)
			return { sessions: 'invalid', sessionFacts: [] }
		seen.add(summary.source)
		const { sessions, turns, compactions, inputTokens, outputTokens } =
			summary
		for (const [metric, total] of Object.entries({
			sessions,
			turns,
			compactions,
			inputTokens,
			outputTokens,
		}))
			sessionFacts.push({
				id: `${host.hostId}.${summary.source}.${metric}`,
				value: total,
			})
	}
	if (!host.approvedSources.every(source => seen.has(source)))
		return { sessions: 'missing', sessionFacts: [] }
	return { sessions: 'valid', sessionFacts }
}

function hostEvidence(
	host: HostInput,
	contract: DailyUsageContract,
	day: string,
): HostEvidence {
	const { usage, usageFacts } = usageEvidence(host, contract, day)
	const { sessions, sessionFacts } = sessionEvidence(host, day)
	return {
		coverage: { hostId: host.hostId, usage, sessions },
		facts: [...usageFacts, ...sessionFacts],
	}
}

type NightlyInput = {
	intendedSlot: string
	actualInvocation: string
	hosts: readonly HostInput[]
	contract: DailyUsageContract
	selection: ModelSelection
	modelAdapter: ModelAdapter
}

type NightlyReport = ProposalReport & {
	coverage: HostCoverage[]
	slot: ReturnType<typeof parisSlotState>
	intendedSlot: string
	actualInvocation: string
	evidenceLimitations: string[]
}

function validateRun(input: NightlyInput): string[] {
	if (timestampOf(input.actualInvocation) < timestampOf(input.intendedSlot))
		throw new Error(
			'Actual invocation must be at or after the intended slot',
		)
	const roster = input.hosts.map(host => host.hostId).toSorted()
	if (
		!roster.length ||
		!roster.every(hostId => /^[a-f0-9]{32}$/.test(hostId)) ||
		new Set(roster).size !== roster.length
	)
		throw new Error('Expected unique enrolled host identities')
	if (input.contract.revision !== USAGE_CONTRACT_REVISION)
		throw new Error('Expected the reviewed Usage #2 contract revision')
	return roster
}

function missingInputs(coverage: HostCoverage[], day: string): string[] {
	return coverage.flatMap(host => [
		...(host.usage === 'valid'
			? []
			: [`usage_snapshot_${host.usage}:${host.hostId}:${day}`]),
		...(host.sessions === 'valid'
			? []
			: [`session_evidence_${host.sessions}:${host.hostId}:${day}`]),
	])
}

export async function runNightly(input: NightlyInput): Promise<NightlyReport> {
	const day = latestClosedUtcDay(input.intendedSlot)
	const slot = parisSlotState(input.intendedSlot)
	const roster = validateRun(input)
	const evidence = input.hosts.map(host =>
		hostEvidence(host, input.contract, day),
	)
	const coverage = evidence
		.map(entry => entry.coverage)
		.toSorted((left, right) => left.hostId.localeCompare(right.hostId))
	const report = await runProposal({
		day,
		roster,
		receivedHosts: coverage
			.filter(host => host.usage === 'valid' && host.sessions === 'valid')
			.map(host => host.hostId),
		invalidHosts: coverage
			.filter(
				host => host.usage === 'invalid' || host.sessions === 'invalid',
			)
			.map(host => host.hostId),
		facts: evidence.flatMap(host => host.facts),
		selection: input.selection,
		modelAdapter: input.modelAdapter,
	})
	return {
		...report,
		missingInputs: missingInputs(coverage, day),
		coverage,
		slot,
		intendedSlot: input.intendedSlot,
		actualInvocation: input.actualInvocation,
		evidenceLimitations: [
			'Native session counts may overlap with the usage ledger. Compare each source separately.',
			'API-equivalent estimates do not measure subscription allowance or billing.',
		],
	}
}
