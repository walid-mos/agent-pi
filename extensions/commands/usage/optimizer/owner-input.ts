import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { readOwnerJson } from './bounded-owner-file.ts'
import { USAGE_CONTRACT_REVISION } from './daily-usage.ts'
import { hostIdSchema, sessionSourceSchema } from './nightly.ts'

import type { Static } from 'typebox'
import type { DailyUsageContract } from './daily-usage.ts'
import type { HostInput } from './nightly.ts'

const ownerPath = Type.String({ minLength: 1 })
const strict = { additionalProperties: false }
const configSchema = Type.Object(
	{
		feedDirectory: Type.Optional(ownerPath),
		stagedEvidence: Type.Optional(
			Type.Object({ snapshots: ownerPath, sessions: ownerPath }, strict),
		),
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

export type OwnerConfig = Static<typeof configSchema>

export async function readOwnerConfig(path: string): Promise<OwnerConfig> {
	if (!isAbsolute(path))
		throw new Error('Expected an absolute owner configuration path')
	const config = (await readOwnerJson(path))?.contents
	if (!Value.Check(configSchema, config))
		throw new Error('Invalid owner configuration')
	const { nativeClaude, hosts } = config
	if (Boolean(config.feedDirectory) === Boolean(config.stagedEvidence))
		throw new Error('Choose exactly one owner evidence handoff')
	const paths = [
		...(config.feedDirectory ? [config.feedDirectory] : []),
		config.reportDirectory,
		config.usageContract.module,
		nativeClaude.executable,
		nativeClaude.home,
		nativeClaude.configDirectory,
		...Object.values(config.stagedEvidence ?? {}),
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
	const { feedDirectory } = config
	if (!feedDirectory) throw new Error('Expected a combined handoff directory')
	const file = await readOwnerJson(join(feedDirectory, `${day}.json`))
	if (!file) return config.hosts.map(host => ({ ...host, sessions: [] }))
	const handoff = file.contents
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
