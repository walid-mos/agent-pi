import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { timestampOf } from './closed-utc-day.ts'

const RECORD_SCHEMA = Type.Record(Type.String(), Type.Unknown())
const UTC_DAY_LENGTH = 10
const ZERO = 0

export type NativeSessionEvidence = {
	hostId: string
	source: 'pi' | 'claude-code'
	day: string
	sessions: number
	turns: number
	compactions: number
	inputTokens: number
	outputTokens: number
}

type Source = NativeSessionEvidence['source']
type Owner = Pick<NativeSessionEvidence, 'hostId' | 'source' | 'day'>
type Summary = {
	hasDayEntry: boolean
	turns: number
	compactions: number
	inputTokens: number
	outputTokens: number
}

function recordOf(candidate: unknown): Record<string, unknown> {
	if (!Value.Check(RECORD_SCHEMA, candidate))
		throw new Error('Expected native session JSON object')
	return candidate
}

function tokenOf(count: unknown): number {
	if (
		typeof count !== 'number' ||
		!Number.isSafeInteger(count) ||
		count < ZERO
	)
		throw new Error('Invalid native session token count')
	return count
}

function messageOf(
	entry: Record<string, unknown>,
	source: Source,
): Record<string, unknown> | undefined {
	if (source === 'pi' && entry.type === 'message') {
		const message = recordOf(entry.message)
		if (typeof message.role !== 'string' || !message.role.trim())
			throw new Error('Expected a native session message role')
		if (message.role !== 'assistant') return undefined
		return message
	}
	if (source === 'claude-code' && entry.type === 'assistant')
		return recordOf(entry.message)
	return undefined
}

function usageTotals(
	usage: unknown,
	source: Source,
): { input: number; output: number } {
	if (!Value.Check(RECORD_SCHEMA, usage))
		throw new Error('Missing or invalid native assistant usage')
	const input = source === 'pi' ? usage.input : usage.input_tokens
	const output = source === 'pi' ? usage.output : usage.output_tokens
	return { input: tokenOf(input), output: tokenOf(output) }
}

function addEntry(
	entry: Record<string, unknown>,
	owner: Owner,
	summary: Summary,
): Summary {
	const isCompaction =
		owner.source === 'pi'
			? entry.type === 'compaction'
			: entry.type === 'system' && entry.subtype === 'compact_boundary'
	const message = messageOf(entry, owner.source)
	if (!isCompaction && !message) return summary
	if (recordDay(entry.timestamp) !== owner.day) return summary
	if (!message)
		return {
			...summary,
			hasDayEntry: true,
			compactions: summary.compactions + Number(isCompaction),
		}
	const totals = usageTotals(message.usage, owner.source)
	return {
		hasDayEntry: true,
		turns: summary.turns + 1,
		compactions: summary.compactions + Number(isCompaction),
		inputTokens: summary.inputTokens + totals.input,
		outputTokens: summary.outputTokens + totals.output,
	}
}

function recordDay(timestamp: unknown): string {
	if (typeof timestamp !== 'string')
		throw new Error('Missing native measurement timestamp')
	const instant = timestampOf(timestamp)
	const date = timestamp.slice(0, UTC_DAY_LENGTH)
	const midnight = new Date(`${date}T00:00:00Z`)
	if (
		!Number.isFinite(midnight.valueOf()) ||
		!midnight.toISOString().startsWith(date)
	)
		throw new Error('Invalid native measurement timestamp date')
	return new Date(instant).toISOString().slice(0, UTC_DAY_LENGTH)
}

function emptySummary(): Summary {
	return {
		hasDayEntry: false,
		turns: ZERO,
		compactions: ZERO,
		inputTokens: ZERO,
		outputTokens: ZERO,
	}
}

export function parseNativeSessionFile(
	lines: string[],
	owner: Owner,
): NativeSessionEvidence | undefined {
	const summary = lines.reduce(
		(current, line) => addEntry(recordOf(JSON.parse(line)), owner, current),
		emptySummary(),
	)
	if (!summary.hasDayEntry) return undefined
	return {
		...owner,
		sessions: 1,
		turns: summary.turns,
		compactions: summary.compactions,
		inputTokens: summary.inputTokens,
		outputTokens: summary.outputTokens,
	}
}
