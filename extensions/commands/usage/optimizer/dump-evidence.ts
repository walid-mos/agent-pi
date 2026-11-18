import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Static } from 'typebox'

const DAY_LENGTH = 10
const unknown = Type.Unknown()
const token = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const nonblank = Type.String({ pattern: /\S/.source })
const entrySchema = Type.Object({
	type: Type.String(),
	timestamp: Type.String(),
})
const messageSchema = Type.Object({ message: Type.Object({ role: nonblank }) })
const assistantSchema = Type.Object({
	usage: Type.Optional(
		Type.Object({
			input: Type.Optional(token),
			output: Type.Optional(token),
		}),
	),
})
const dumpSchema = Type.Object(
	{
		capturedAt: Type.String(),
		runtime: unknown,
		session: Type.Object({
			header: Type.Object({ id: Type.String() }),
			id: Type.String(),
			entries: Type.Array(entrySchema),
		}),
		prompt: unknown,
		inFlight: unknown,
	},
	{ additionalProperties: false },
)

export type DumpEvidence = {
	day: string
	sessions: number
	turns: number
	compactions: number
	inputTokens: number
	outputTokens: number
}

function utcDay(timestamp: string): string {
	const instant = Date.parse(timestamp)
	if (!Number.isFinite(instant)) throw new Error('Invalid Pi dump date')
	return new Date(instant).toISOString().slice(0, DAY_LENGTH)
}

export function parseDumpEvidence(
	candidate: unknown,
	day: string,
): DumpEvidence {
	if (!Value.Check(dumpSchema, candidate))
		throw new Error('Unexpected fields in Pi dump')
	if (utcDay(candidate.capturedAt) !== day)
		throw new Error('Pi dump date does not match requested UTC day')
	const { session } = candidate
	if (!session.id.trim() || session.header.id !== session.id)
		throw new Error('Pi dump session identity does not match')
	return summarizeEntries(session.entries, day)
}

function assistantMessage(
	entry: Static<typeof entrySchema>,
): Static<typeof assistantSchema> | undefined {
	if (entry.type !== 'message') return undefined
	if (!Value.Check(messageSchema, entry))
		throw new Error('Invalid Pi dump message or role')
	const { message } = entry
	if (message.role !== 'assistant') return undefined
	if (!Value.Check(assistantSchema, message))
		throw new Error('Invalid Pi dump assistant usage')
	return message
}

function summarizeEntries(
	entries: Static<typeof entrySchema>[],
	day: string,
): DumpEvidence {
	let turns = 0
	let compactions = 0
	let inputTokens = 0
	let outputTokens = 0
	for (const entry of entries) {
		const message = assistantMessage(entry)
		if (utcDay(entry.timestamp) !== day) continue
		if (entry.type === 'compaction') compactions++
		if (!message) continue
		turns++
		inputTokens += message.usage?.input ?? 0
		outputTokens += message.usage?.output ?? 0
	}
	if (
		!Number.isSafeInteger(inputTokens) ||
		!Number.isSafeInteger(outputTokens)
	)
		throw new Error('Pi dump token totals exceed the supported range')
	return { day, sessions: 1, turns, compactions, inputTokens, outputTokens }
}
