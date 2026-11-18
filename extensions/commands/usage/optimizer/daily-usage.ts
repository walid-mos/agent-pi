import type { Fact } from './proposal.ts'

export const USAGE_CONTRACT_REVISION =
	'c28162911b5dfc539e20f26e22bb93359e31dbc1'

type Measurement = { sum: number; missing: number }
type Totals = {
	events: number
	failed: number
	metrics: {
		input: Measurement
		output: Measurement
		durationMs: Measurement
		estimateUsd: Measurement
	}
}

export type DailyUsageContract = {
	revision: string
	decodeSnapshot: (
		snapshot: unknown,
		hostId: string,
		day: string,
	) => {
		usage: { workload: Totals; 'routing-overhead': Totals }
	}
}

export function readDailyFacts(
	contract: DailyUsageContract,
	snapshot: unknown,
	hostId: string,
	day: string,
): Fact[] {
	const { usage } = contract.decodeSnapshot(snapshot, hostId, day)
	return [
		...totalsFacts(`${hostId}.workload`, usage.workload),
		...totalsFacts(`${hostId}.routing-overhead`, usage['routing-overhead']),
	]
}

function totalsFacts(prefix: string, totals: Totals): Fact[] {
	return [
		{ id: `${prefix}.events`, value: totals.events },
		{ id: `${prefix}.failed`, value: totals.failed },
		...Object.entries(totals.metrics)
			.filter(([metric]) =>
				['input', 'output', 'durationMs', 'estimateUsd'].includes(
					metric,
				),
			)
			.flatMap(([metric, measurement]) => [
				{ id: `${prefix}.${metric}.sum`, value: measurement.sum },
				{
					id: `${prefix}.${metric}.missing`,
					value: measurement.missing,
				},
			]),
	]
}
