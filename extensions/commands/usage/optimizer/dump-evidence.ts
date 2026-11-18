import { Type } from 'typebox'
import { Value } from 'typebox/value'

const UTC_DAY_LENGTH = 10
const UNKNOWN = Type.Unknown()
const usageSchema = Type.Object(
	{
		input: Type.Optional(Type.Integer({ minimum: 0 })),
		output: Type.Optional(Type.Integer({ minimum: 0 })),
		cacheRead: Type.Optional(Type.Integer({ minimum: 0 })),
		cacheWrite: Type.Optional(Type.Integer({ minimum: 0 })),
		reasoning: Type.Optional(Type.Integer({ minimum: 0 })),
		cost: Type.Optional(UNKNOWN),
	},
	{ additionalProperties: false },
)
const messageSchema = Type.Object(
	{
		role: Type.Optional(Type.String()),
		model: Type.Optional(Type.String()),
		provider: Type.Optional(Type.String()),
		usage: Type.Optional(usageSchema),
		content: Type.Optional(UNKNOWN),
		timestamp: Type.Optional(Type.Number()),
		stopReason: Type.Optional(Type.String()),
		durationMs: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
)
const entrySchema = Type.Object(
	{
		type: Type.Optional(Type.String()),
		timestamp: Type.Optional(Type.String()),
		message: Type.Optional(messageSchema),
		tokensBefore: Type.Optional(Type.Number()),
		fromHook: Type.Optional(Type.Boolean()),
		customType: Type.Optional(Type.String()),
		data: Type.Optional(UNKNOWN),
		content: Type.Optional(UNKNOWN),
	},
	{ additionalProperties: false },
)
const sessionSchema = Type.Object(
	{
		header: Type.Optional(UNKNOWN),
		id: Type.Optional(Type.String()),
		file: Type.Optional(Type.String()),
		name: Type.Optional(Type.String()),
		leafId: Type.Optional(Type.String()),
		branchEntryIds: Type.Optional(Type.Array(Type.String())),
		modelContext: Type.Optional(UNKNOWN),
		entries: Type.Array(entrySchema),
	},
	{ additionalProperties: false },
)
const dumpSchema = Type.Object(
	{
		capturedAt: Type.String(),
		runtime: UNKNOWN,
		session: sessionSchema,
		prompt: UNKNOWN,
		inFlight: UNKNOWN,
	},
	{ additionalProperties: false },
)

export type DumpEvidence = {
	day: string
	sessions: number
	turns: number
	compactions: number
	models: string[]
	inputTokens: number
	outputTokens: number
}

function tokenCount(candidate: unknown): number {
	if (
		typeof candidate !== 'number' ||
		!Number.isSafeInteger(candidate) ||
		candidate < 0
	)
		throw new Error('Invalid approved token total')
	return candidate
}

export function parseDumpEvidence(
	candidate: unknown,
	day: string,
): DumpEvidence {
	if (!Value.Check(dumpSchema, candidate))
		throw new Error('Unexpected fields in Pi dump')
	if (candidate.capturedAt.slice(0, UTC_DAY_LENGTH) !== day)
		throw new Error('Pi dump date does not match requested UTC day')
	let turns = 0
	let compactions = 0
	let inputTokens = 0
	let outputTokens = 0
	const models = new Set<string>()
	for (const entry of candidate.session.entries) {
		if (entry.type === 'compaction') compactions++
		if (entry.type !== 'message' || entry.message?.role !== 'assistant')
			continue
		turns++
		if (entry.message.model) models.add(entry.message.model)
		inputTokens += tokenCount(entry.message.usage?.input ?? 0)
		outputTokens += tokenCount(entry.message.usage?.output ?? 0)
	}
	return {
		day,
		sessions: 1,
		turns,
		compactions,
		models: [...models].toSorted(),
		inputTokens,
		outputTokens,
	}
}
