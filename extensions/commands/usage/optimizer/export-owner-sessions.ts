import {
	mkdtemp,
	opendir,
	realpath,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { readBoundedFile, readOwnerJson } from './bounded-owner-file.ts'
import { latestClosedUtcDay, latestParisSlot } from './closed-utc-day.ts'
import { parseNativeSessionFile } from './native-session-evidence.ts'
import { hostIdSchema, sessionSchema, sessionSourceSchema } from './nightly.ts'
import { sessionEvidenceName } from './session-evidence-name.ts'

import type { NativeSessionEvidence } from './native-session-evidence.ts'

const USAGE =
	'Usage: node export-owner-sessions.ts ABSOLUTE_APPROVAL UTC_DAY|--scheduled ABSOLUTE_OUTPUT_DIRECTORY'
const ARGUMENT_START = 2
const MAX_SESSION_BYTES = 16_777_216
const MAX_SESSION_FILES = 256
const MAX_PROJECT_DIRECTORIES = 16
const MAX_DIRECTORY_ENTRIES = 1024
const approvedHost = { hostId: hostIdSchema, source: sessionSourceSchema }
const recurringSchema = Type.Object(
	{
		...approvedHost,
		directories: Type.Array(Type.String(), {
			uniqueItems: true,
			minItems: 1,
			maxItems: MAX_PROJECT_DIRECTORIES,
		}),
	},
	{ additionalProperties: false },
)
const manifestSchema = Type.Object(
	{
		...approvedHost,
		day: Type.String(),
		files: Type.Array(Type.String(), {
			uniqueItems: true,
			maxItems: MAX_SESSION_FILES,
		}),
	},
	{ additionalProperties: false },
)

type Scope = Pick<NativeSessionEvidence, 'hostId' | 'day' | 'source'>

async function summarize(
	scope: Scope,
	files: string[],
): Promise<NativeSessionEvidence | undefined> {
	const initial = {
		...scope,
		sessions: 0,
		turns: 0,
		compactions: 0,
		inputTokens: 0,
		outputTokens: 0,
	}
	const summary = await files.reduce(async (pending, file) => {
		const previous = await pending
		const next = await summarizeFile(scope, file)
		if (!next) return previous
		return {
			...scope,
			sessions: previous.sessions + next.sessions,
			turns: previous.turns + next.turns,
			compactions: previous.compactions + next.compactions,
			inputTokens: previous.inputTokens + next.inputTokens,
			outputTokens: previous.outputTokens + next.outputTokens,
		}
	}, Promise.resolve(initial))
	if (!summary.sessions && files.length) return undefined
	if (!Value.Check(sessionSchema, summary))
		throw new Error('Invalid session aggregate counts')
	return summary
}

async function summarizeFile(
	scope: Scope,
	file: string,
): Promise<NativeSessionEvidence | undefined> {
	if (file !== resolve(file) || !file.endsWith('.jsonl'))
		throw new Error('Expected approved absolute native JSONL paths')
	const bytes = await readBoundedFile(file, MAX_SESSION_BYTES)
	if (!bytes) throw new Error('An approved local session file is missing')
	try {
		const lines = new TextDecoder('utf-8', { fatal: true })
			.decode(bytes)
			.split(/\r?\n/)
			.filter(line => line.trim())
		return parseNativeSessionFile(lines, scope)
	} catch (error) {
		throw new Error('Invalid approved local session file', { cause: error })
	}
}

async function discoverSessions(directories: string[]): Promise<string[]> {
	const files: string[] = []
	await directories.reduce(
		async (pending, directory) =>
			scanDirectory(directory, files, await pending),
		Promise.resolve(0),
	)
	return files
}

async function scanDirectory(
	directory: string,
	files: string[],
	previousEntries: number,
): Promise<number> {
	if (
		directory !== resolve(directory) ||
		(await realpath(directory)) !== directory
	)
		throw new Error('Expected a canonical approved project directory')
	let entries = previousEntries
	for await (const entry of await opendir(directory)) {
		entries++
		if (entries > MAX_DIRECTORY_ENTRIES)
			throw new Error('Approved project scan exceeds its entry limit')
		if (!entry.name.endsWith('.jsonl')) continue
		if (!entry.isFile() || files.length >= MAX_SESSION_FILES)
			throw new Error(
				'Expected a bounded set of regular project JSONL files',
			)
		files.push(join(directory, entry.name))
	}
	return entries
}

async function publish(
	directory: string,
	summary: NativeSessionEvidence,
): Promise<void> {
	const staging = await mkdtemp(join(directory, '.session-'))
	try {
		const file = join(staging, 'aggregate.json')
		await writeFile(file, JSON.stringify(summary), { mode: 0o600 })
		await rename(file, join(directory, sessionEvidenceName(summary)))
	} finally {
		await rm(staging, { recursive: true, force: true })
	}
}

function isClosedDay(day: string, now: string): boolean {
	const midnight = new Date(`${day}T00:00:00Z`)
	return (
		Number.isFinite(midnight.valueOf()) &&
		midnight.toISOString().startsWith(`${day}T`) &&
		day <= latestClosedUtcDay(now)
	)
}

async function main(args: string[]): Promise<void> {
	const [approvalPath, requestedDay, directory, ...extra] = args
	if (approvalPath === '--help' && !requestedDay) {
		process.stdout.write(`${USAGE}\n`)
		return
	}
	if (
		!approvalPath ||
		!requestedDay ||
		!directory ||
		extra.length ||
		!isAbsolute(approvalPath) ||
		!isAbsolute(directory)
	)
		throw new Error(USAGE)
	const now = new Date().toISOString()
	const day =
		requestedDay === '--scheduled'
			? latestClosedUtcDay(latestParisSlot(now))
			: requestedDay
	if (!isClosedDay(day, now)) throw new Error(USAGE)
	const approval = (await readOwnerJson(approvalPath))?.contents
	const summary = await collect(approval, day)
	if (summary) await publish(directory, summary)
	process.stdout.write(
		`${summary ? `published ${sessionEvidenceName(summary)}` : `missing ${day}`}\n`,
	)
}

async function collect(
	approval: unknown,
	day: string,
): Promise<NativeSessionEvidence | undefined> {
	if (Value.Check(recurringSchema, approval)) {
		const { hostId, source, directories } = approval
		const files = await discoverSessions(directories)
		if (!files.length) return undefined
		return summarize({ hostId, source, day }, files)
	}
	if (!Value.Check(manifestSchema, approval) || approval.day !== day)
		throw new Error('Invalid owner-approved session configuration')
	const { hostId, source, files } = approval
	return summarize({ hostId, source, day }, files)
}

try {
	await main(process.argv.slice(ARGUMENT_START))
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : 'Session evidence export failed'}\n`,
	)
	process.exitCode = 1
}
