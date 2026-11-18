import {
	measuredDay,
	measuredTokens,
	sessionRecord,
} from './session-measurement.ts'

import type { SessionSource } from './session-measurement.ts'

export type NativeSessionEvidence = {
	hostId: string
	source: SessionSource
	day: string
	sessions: number
	turns: number
	compactions: number
	inputTokens: number
	outputTokens: number
}

type Owner = Pick<NativeSessionEvidence, 'hostId' | 'source' | 'day'>
type Entry = Record<string, unknown>
type Measurement = { day: string; sessionId: string; timestamp: unknown } & (
	| { kind: 'compaction' }
	| {
			kind: 'assistant'
			input: number
			output: number
			requestId: string | undefined
	  }
)

function requiredId(candidate: unknown, label: string): string {
	if (typeof candidate !== 'string' || !candidate.trim())
		throw new Error(`Missing or invalid ${label} identity`)
	return candidate
}

function piHeaderId(entry: Entry, prior: string | undefined): string {
	if (prior) throw new Error('Unexpected second Pi session header identity')
	return requiredId(entry.id, 'Pi session')
}

function assistantMessage(
	entry: Entry,
	source: SessionSource,
): Entry | undefined {
	const expectedType = source === 'pi' ? 'message' : 'assistant'
	if (entry.type !== expectedType) return undefined
	const message = sessionRecord(entry.message)
	if (typeof message.role !== 'string' || !message.role.trim())
		throw new Error('Expected a native session message role')
	if (message.role === 'assistant') return message
	if (source === 'claude-code')
		throw new Error('Claude Code assistant role does not match record type')
	return undefined
}

function isCompaction(entry: Entry, source: SessionSource): boolean {
	return source === 'pi'
		? entry.type === 'compaction'
		: entry.type === 'system' && entry.subtype === 'compact_boundary'
}

function sameMeasurement(prior: Measurement, next: Measurement): boolean {
	return (
		prior.sessionId === next.sessionId &&
		prior.day === next.day &&
		prior.timestamp === next.timestamp &&
		(prior.kind === 'compaction'
			? next.kind === 'compaction'
			: next.kind === 'assistant' &&
				prior.input === next.input &&
				prior.output === next.output)
	)
}

function canonicalMeasurement(
	prior: Measurement,
	next: Measurement,
	source: SessionSource,
): Measurement {
	if (source === 'pi' || next.kind === 'compaction') {
		if (sameMeasurement(prior, next)) return prior
		throw new Error('Conflicting native measurement identity')
	}
	if (
		prior.kind !== 'assistant' ||
		prior.sessionId !== next.sessionId ||
		prior.day !== next.day ||
		prior.input !== next.input ||
		(prior.requestId &&
			next.requestId &&
			prior.requestId !== next.requestId)
	)
		throw new Error(
			'Conflicting Claude Code response identity or measurement',
		)
	return {
		...prior,
		output: Math.max(prior.output, next.output),
		requestId: prior.requestId ?? next.requestId,
	}
}

export class NativeSessionCollector {
	readonly #owner: Owner
	readonly #measurements = new Map<string, Measurement>()
	readonly #piFileEntries = new Map<string, string>()
	readonly #claudeRequests = new Map<string, string>()

	constructor(owner: Owner) {
		this.#owner = owner
	}

	addFile(lines: string[]): void {
		const { source } = this.#owner
		let sessionId: string | undefined
		const piEntries = new Set<string>()
		for (const line of lines) {
			const entry = sessionRecord(JSON.parse(line))
			if (source === 'pi' && entry.type === 'session') {
				sessionId = piHeaderId(entry, sessionId)
				continue
			}
			const message = assistantMessage(entry, source)
			if (!message && !isCompaction(entry, source)) continue
			const day = measuredDay(entry.timestamp)
			const tokens = message && measuredTokens(message.usage, source)
			const recordSessionId = requiredId(
				source === 'pi' ? sessionId : entry.sessionId,
				'native session',
			)
			if (sessionId && sessionId !== recordSessionId)
				throw new Error(
					'Conflicting native session identity in one file',
				)
			sessionId = recordSessionId
			const id = this.#addMeasurement(
				entry,
				{ day, sessionId, timestamp: entry.timestamp },
				message,
				tokens,
			)
			if (source === 'pi') piEntries.add(id)
		}
		if (source === 'pi' && sessionId)
			this.#checkPiCopy(sessionId, piEntries)
	}

	#checkPiCopy(sessionId: string, ids: Set<string>): void {
		const signature = JSON.stringify([...ids].toSorted())
		const prior = this.#piFileEntries.get(sessionId)
		if (prior && prior !== signature)
			throw new Error(
				'Conflicting Pi session copies have different measured entries',
			)
		this.#piFileEntries.set(sessionId, signature)
	}

	#addMeasurement(
		entry: Entry,
		scope: Pick<Measurement, 'day' | 'sessionId' | 'timestamp'>,
		message: Entry | undefined,
		tokens: ReturnType<typeof measuredTokens> | undefined,
	): string {
		const { source } = this.#owner
		const isClaudeResponse = source === 'claude-code' && Boolean(message)
		const recordId = source === 'pi' ? entry.id : entry.uuid
		const id = requiredId(
			isClaudeResponse ? message?.id : recordId,
			'native measurement',
		)
		const key = isClaudeResponse
			? JSON.stringify([id])
			: JSON.stringify([scope.sessionId, id])
		const requestId =
			isClaudeResponse && Object.hasOwn(entry, 'requestId')
				? requiredId(entry.requestId, 'Claude Code request')
				: undefined
		const next: Measurement = tokens
			? { ...scope, kind: 'assistant', requestId, ...tokens }
			: { ...scope, kind: 'compaction' }
		const prior = this.#measurements.get(key)
		if (requestId) this.#checkClaudeRequest(requestId, id)
		this.#measurements.set(
			key,
			prior ? canonicalMeasurement(prior, next, source) : next,
		)
		return id
	}

	#checkClaudeRequest(requestId: string, messageId: string): void {
		const prior = this.#claudeRequests.get(requestId)
		if (prior && prior !== messageId)
			throw new Error(
				'Conflicting Claude Code request and message identities',
			)
		this.#claudeRequests.set(requestId, messageId)
	}

	summarize(): NativeSessionEvidence | undefined {
		const sessions = new Set<string>()
		let turns = 0
		let compactions = 0
		let inputTokens = 0
		let outputTokens = 0
		for (const measurement of this.#measurements.values()) {
			if (measurement.day !== this.#owner.day) continue
			sessions.add(measurement.sessionId)
			if (measurement.kind === 'compaction') {
				compactions++
				continue
			}
			turns++
			inputTokens += measurement.input
			outputTokens += measurement.output
		}
		if (!sessions.size) return undefined
		return {
			...this.#owner,
			sessions: sessions.size,
			turns,
			compactions,
			inputTokens,
			outputTokens,
		}
	}
}

export function parseNativeSessionFile(
	lines: string[],
	owner: Owner,
): NativeSessionEvidence | undefined {
	const collector = new NativeSessionCollector(owner)
	collector.addFile(lines)
	return collector.summarize()
}
