import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { readBoundedFile, readOwnerJson } from './bounded-owner-file.ts'
import { latestClosedUtcDay } from './closed-utc-day.ts'
import { parseNativeSessionFile } from './native-session-evidence.ts'
import { hostIdSchema, sessionSchema, sessionSourceSchema } from './nightly.ts'
import { sessionEvidenceName } from './session-evidence-name.ts'

import type { NativeSessionEvidence } from './native-session-evidence.ts'

const USAGE =
	'Usage: node export-owner-sessions.ts ABSOLUTE_MANIFEST UTC_DAY ABSOLUTE_OUTPUT_DIRECTORY'
const ARGUMENT_START = 2
const MAX_SESSION_BYTES = 16_777_216
const MAX_SESSION_FILES = 256
const manifestSchema = Type.Object(
	{
		hostId: hostIdSchema,
		day: Type.String(),
		source: sessionSourceSchema,
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
): Promise<NativeSessionEvidence> {
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
		return {
			...scope,
			sessions: previous.sessions + next.sessions,
			turns: previous.turns + next.turns,
			compactions: previous.compactions + next.compactions,
			inputTokens: previous.inputTokens + next.inputTokens,
			outputTokens: previous.outputTokens + next.outputTokens,
		}
	}, Promise.resolve(initial))
	if (!Value.Check(sessionSchema, summary))
		throw new Error('Invalid session aggregate counts')
	return summary
}

async function summarizeFile(
	scope: Scope,
	file: string,
): Promise<NativeSessionEvidence> {
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

function isClosedDay(day: string): boolean {
	const midnight = new Date(`${day}T00:00:00Z`)
	return (
		Number.isFinite(midnight.valueOf()) &&
		midnight.toISOString().startsWith(`${day}T`) &&
		day <= latestClosedUtcDay(new Date().toISOString())
	)
}

async function main(args: string[]): Promise<void> {
	const [manifestPath, day, directory, ...extra] = args
	if (manifestPath === '--help' && !day) {
		process.stdout.write(`${USAGE}\n`)
		return
	}
	if (
		!manifestPath ||
		!day ||
		!directory ||
		extra.length ||
		!isAbsolute(manifestPath) ||
		!isAbsolute(directory) ||
		!isClosedDay(day)
	)
		throw new Error(USAGE)
	const manifest = (await readOwnerJson(manifestPath))?.contents
	if (!Value.Check(manifestSchema, manifest) || manifest.day !== day)
		throw new Error('Invalid owner-approved session manifest')
	const { hostId, source, files } = manifest
	await publish(directory, await summarize({ hostId, source, day }, files))
}

try {
	await main(process.argv.slice(ARGUMENT_START))
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : 'Session evidence export failed'}\n`,
	)
	process.exitCode = 1
}
