import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { timestampOf } from './closed-utc-day.ts'

const UTC_DAY_LENGTH = 10
const usageFields = {
	pi: { input: 'input', output: 'output' },
	'claude-code': { input: 'input_tokens', output: 'output_tokens' },
} as const
const recordSchema = Type.Record(Type.String(), Type.Unknown())

export type SessionSource = keyof typeof usageFields

export function sessionRecord(candidate: unknown): Record<string, unknown> {
	if (!Value.Check(recordSchema, candidate))
		throw new Error('Expected native session JSON object')
	return candidate
}

export function measuredDay(timestamp: unknown): string {
	if (typeof timestamp !== 'string')
		throw new Error('Missing measurement timestamp')
	const instant = timestampOf(timestamp)
	const date = timestamp.slice(0, UTC_DAY_LENGTH)
	const midnight = new Date(`${date}T00:00:00Z`)
	if (
		!Number.isFinite(midnight.valueOf()) ||
		!midnight.toISOString().startsWith(date)
	)
		throw new Error('Invalid measurement timestamp date')
	return new Date(instant).toISOString().slice(0, UTC_DAY_LENGTH)
}

function tokenOf(count: unknown): number {
	if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
		throw new Error('Invalid native session token count')
	return count
}

export function measuredTokens(
	usage: unknown,
	source: SessionSource,
): { input: number; output: number } {
	if (!Value.Check(recordSchema, usage))
		throw new Error('Missing or invalid native assistant usage')
	const { input, output } = usageFields[source]
	return { input: tokenOf(usage[input]), output: tokenOf(usage[output]) }
}
