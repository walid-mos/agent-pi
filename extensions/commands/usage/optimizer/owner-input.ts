import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { USAGE_CONTRACT_REVISION } from './daily-usage.ts'
import { hostIdSchema, sessionSourceSchema } from './nightly.ts'

import type { FileHandle } from 'node:fs/promises'
import type { Static } from 'typebox'
import type { DailyUsageContract } from './daily-usage.ts'
import type { HostInput } from './nightly.ts'

const MAX_OWNER_JSON_BYTES = 4_194_304
const ownerPath = Type.String({ minLength: 1 })
const strict = { additionalProperties: false }
const configSchema = Type.Object(
	{
		feedDirectory: ownerPath,
		reportDirectory: ownerPath,
		usageContract: Type.Object(
			{
				revision: Type.Literal(USAGE_CONTRACT_REVISION),
				module: ownerPath,
			},
			strict,
		),
		hosts: Type.Array(
			Type.Object(
				{
					hostId: hostIdSchema,
					approvedSources: Type.Array(sessionSourceSchema, {
						uniqueItems: true,
					}),
				},
				strict,
			),
			{ minItems: 1 },
		),
		nativeClaude: Type.Object(
			{
				executable: ownerPath,
				home: ownerPath,
				configDirectory: ownerPath,
				isPrintApproved: Type.Boolean(),
			},
			strict,
		),
	},
	strict,
)
const handoffSchema = Type.Object(
	{
		day: Type.String(),
		hosts: Type.Array(
			Type.Object(
				{
					hostId: hostIdSchema,
					snapshot: Type.Optional(Type.Unknown()),
					sessions: Type.Array(Type.Unknown()),
				},
				strict,
			),
		),
	},
	strict,
)

type OwnerConfig = Static<typeof configSchema>

export async function readOwnerConfig(path: string): Promise<OwnerConfig> {
	if (!isAbsolute(path))
		throw new Error('Expected an absolute owner configuration path')
	const config = (await readJson(path))?.contents
	if (!Value.Check(configSchema, config))
		throw new Error('Invalid owner configuration')
	const { nativeClaude, hosts } = config
	const paths = [
		config.feedDirectory,
		config.reportDirectory,
		config.usageContract.module,
		nativeClaude.executable,
		nativeClaude.home,
		nativeClaude.configDirectory,
	]
	if (
		!paths.every(isAbsolute) ||
		new Set(hosts.map(host => host.hostId)).size !== hosts.length
	)
		throw new Error(
			'Expected absolute owner paths and unique enrolled hosts',
		)
	return config
}

export async function readOwnerHandoff(
	config: OwnerConfig,
	day: string,
): Promise<HostInput[]> {
	const handoffFile = await readJson(
		join(config.feedDirectory, `${day}.json`),
	)
	if (!handoffFile)
		return config.hosts.map(host => ({ ...host, sessions: [] }))
	const handoff = handoffFile.contents
	if (!Value.Check(handoffSchema, handoff) || handoff.day !== day)
		throw new Error('Invalid aggregate handoff for the intended UTC day')
	const enrolled = new Set(config.hosts.map(host => host.hostId))
	const received = new Map(handoff.hosts.map(host => [host.hostId, host]))
	if (
		received.size !== handoff.hosts.length ||
		[...received.keys()].some(hostId => !enrolled.has(hostId))
	)
		throw new Error('Invalid aggregate handoff host identities')
	return config.hosts.map(host => ({
		sessions: [],
		...received.get(host.hostId),
		...host,
	}))
}

export async function loadOwnerDecoder(
	config: OwnerConfig,
): Promise<DailyUsageContract> {
	try {
		const decoder: unknown = await import(
			pathToFileURL(config.usageContract.module).href
		)
		if (!hasDecoder(decoder))
			throw new Error('Missing decodeSnapshot export')
		return {
			revision: config.usageContract.revision,
			decodeSnapshot: decoder.decodeSnapshot,
		}
	} catch {
		throw new Error(
			'Load the reviewed Usage #2 decodeSnapshot module from the owner configuration',
		)
	}
}

function hasDecoder(
	candidate: unknown,
): candidate is Pick<DailyUsageContract, 'decodeSnapshot'> {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		'decodeSnapshot' in candidate &&
		typeof candidate.decodeSnapshot === 'function'
	)
}

async function readJson(
	path: string,
): Promise<{ contents: unknown } | undefined> {
	try {
		const file = await open(
			path,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		)
		try {
			return { contents: await readContents(file) }
		} finally {
			await file.close()
		}
	} catch (error) {
		if (Value.Check(Type.Object({ code: Type.Literal('ENOENT') }), error))
			return undefined
		throw new Error(
			'Could not read bounded owner configuration or aggregate handoff JSON',
			{ cause: error },
		)
	}
}

async function readContents(file: FileHandle): Promise<unknown> {
	const before = await file.stat()
	if (
		!before.isFile() ||
		before.size > MAX_OWNER_JSON_BYTES ||
		before.nlink !== 1
	)
		throw new Error('Expected bounded regular JSON file')
	const bytes = Buffer.alloc(before.size + 1)
	const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
	const after = await file.stat()
	if (
		bytesRead !== before.size ||
		before.mtimeMs !== after.mtimeMs ||
		before.ctimeMs !== after.ctimeMs
	)
		throw new Error('JSON file changed during read')
	return JSON.parse(bytes.toString('utf8', 0, bytesRead))
}
