import { Type } from 'typebox'
import { Value } from 'typebox/value'

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
	if (source === 'pi' && entry.type === 'message')
		return recordOf(entry.message)
	if (source === 'claude-code' && entry.type === 'assistant')
		return { ...recordOf(entry.message), role: 'assistant' }
	return undefined
}

function usageTotals(
	usage: unknown,
	source: Source,
): { input: number; output: number } {
	if (!usage) return { input: ZERO, output: ZERO }
	const usageRecord = recordOf(usage)
	const input = source === 'pi' ? usageRecord.input : usageRecord.input_tokens
	const output =
		source === 'pi' ? usageRecord.output : usageRecord.output_tokens
	return { input: tokenOf(input ?? ZERO), output: tokenOf(output ?? ZERO) }
}

function addEntry(
	entry: Record<string, unknown>,
	owner: Owner,
	summary: Summary,
): Summary {
	const { timestamp } = entry
	if (typeof timestamp !== 'string') return summary
	const timestampMs = Date.parse(timestamp)
	if (
		!Number.isFinite(timestampMs) ||
		new Date(timestampMs).toISOString().slice(0, UTC_DAY_LENGTH) !==
			owner.day
	)
		return summary
	const isCompaction =
		entry.type === 'compaction' ||
		(entry.type === 'system' && entry.subtype === 'compact_boundary')
	const message = messageOf(entry, owner.source)
	if (message?.role !== 'assistant')
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
): NativeSessionEvidence {
	const summary = lines.reduce(
		(current, line) => addEntry(recordOf(JSON.parse(line)), owner, current),
		emptySummary(),
	)
	return {
		hostId: owner.hostId,
		source: owner.source,
		day: owner.day,
		sessions: summary.hasDayEntry ? 1 : ZERO,
		turns: summary.turns,
		compactions: summary.compactions,
		inputTokens: summary.inputTokens,
		outputTokens: summary.outputTokens,
	}
}
