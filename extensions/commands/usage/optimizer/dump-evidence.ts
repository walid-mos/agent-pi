import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { measuredDay, measuredTokens } from './session-measurement.ts'

import type { Static } from 'typebox'

const unknown = Type.Unknown()
const nonblank = Type.String({ pattern: /\S/.source })
const entrySchema = Type.Object({
	type: Type.String(),
	timestamp: Type.String(),
})
const messageSchema = Type.Object({
	message: Type.Object({ role: nonblank, usage: Type.Optional(unknown) }),
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

export function parseDumpEvidence(
	candidate: unknown,
	day: string,
): DumpEvidence {
	if (!Value.Check(dumpSchema, candidate))
		throw new Error('Unexpected fields in Pi dump')
	if (measuredDay(candidate.capturedAt) !== day)
		throw new Error('Pi dump date does not match requested UTC day')
	const { session } = candidate
	if (!session.id.trim() || session.header.id !== session.id)
		throw new Error('Pi dump session identity does not match')
	return summarizeEntries(session.entries, day)
}

function assistantMessage(
	entry: Static<typeof entrySchema>,
): Static<typeof messageSchema>['message'] | undefined {
	if (entry.type !== 'message') return undefined
	if (!Value.Check(messageSchema, entry))
		throw new Error('Invalid Pi dump message or role')
	const { message } = entry
	if (message.role !== 'assistant') return undefined
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
		const entryDay = measuredDay(entry.timestamp)
		const tokens = message && measuredTokens(message.usage, 'pi')
		if (entryDay !== day) continue
		if (entry.type === 'compaction') compactions++
		if (!tokens) continue
		turns++
		inputTokens += tokens.input
		outputTokens += tokens.output
	}
	if (
		!Number.isSafeInteger(inputTokens) ||
		!Number.isSafeInteger(outputTokens)
	)
		throw new Error('Pi dump token totals exceed the supported range')
	return { day, sessions: 1, turns, compactions, inputTokens, outputTokens }
}
