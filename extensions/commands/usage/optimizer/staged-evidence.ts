import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Value } from 'typebox/value'

import { readBoundedFile, readOwnerJson } from './bounded-owner-file.ts'
import { sessionSchema } from './nightly.ts'
import { sessionEvidenceName } from './session-evidence-name.ts'

import type { HostInput, PublishedUsage } from './nightly.ts'
import type { OwnerConfig } from './owner-input.ts'

type Store = {
	get: (
		key: string,
	) => Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>
}
type ReadPublication = (
	store: Store,
	roster: { hostId: string; alias: string }[],
	day: string,
) => Promise<{ hosts: (PublishedUsage & { hostId: string })[] }>
type Staged = NonNullable<OwnerConfig['stagedEvidence']>

export async function readStagedEvidence(
	config: OwnerConfig,
	staged: Staged,
	day: string,
): Promise<HostInput[]> {
	const { readDailyPublication, limit } = await loadPublication(
		config.usageContract.module,
	)
	const roster = config.hosts.map(({ hostId }) => ({ hostId, alias: hostId }))
	const store = {
		get: (key: string) => readStagedSnapshot(staged.snapshots, key, limit),
	}
	const { hosts } = await readDailyPublication(store, roster, day)
	const published = new Map(hosts.map(host => [host.hostId, host]))
	return Promise.all(
		config.hosts.map(async host => ({
			...host,
			publication: published.get(host.hostId) ?? { status: 'missing' },
			sessions: (
				await Promise.all(
					host.approvedSources.map(source =>
						readSession(staged.sessions, {
							hostId: host.hostId,
							day,
							source,
						}),
					),
				)
			).filter(summary => typeof summary !== 'undefined'),
		})),
	)
}

async function loadPublication(
	decoderPath: string,
): Promise<{ readDailyPublication: ReadPublication; limit: number }> {
	const path = join(dirname(decoderPath), 'readDailyPublication.ts')
	const publication: unknown = await import(pathToFileURL(path).href)
	if (!hasReader(publication))
		throw new Error(
			'Expected the pinned Usage #2 readDailyPublication export',
		)
	const decoder: unknown = await import(pathToFileURL(decoderPath).href)
	if (
		typeof decoder !== 'object' ||
		decoder === null ||
		!('SNAPSHOT_LIMIT' in decoder) ||
		typeof decoder.SNAPSHOT_LIMIT !== 'number' ||
		!Number.isSafeInteger(decoder.SNAPSHOT_LIMIT) ||
		decoder.SNAPSHOT_LIMIT <= 0
	)
		throw new Error('Expected the pinned Usage #2 snapshot byte limit')
	return {
		readDailyPublication: publication.readDailyPublication,
		limit: decoder.SNAPSHOT_LIMIT,
	}
}

function hasReader(
	candidate: unknown,
): candidate is { readDailyPublication: ReadPublication } {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		'readDailyPublication' in candidate &&
		typeof candidate.readDailyPublication === 'function'
	)
}

async function readStagedSnapshot(
	directory: string,
	key: string,
	limit: number,
): ReturnType<Store['get']> {
	const path = join(directory, key)
	const bytes = await readBoundedFile(path, limit).catch(() =>
		Buffer.alloc(0),
	)
	if (!bytes) return null
	return {
		size: bytes.length,
		body: new Response(new Uint8Array(bytes)).body ?? new ReadableStream(),
	}
}

async function readSession(
	directory: string,
	scope: Parameters<typeof sessionEvidenceName>[0],
): Promise<unknown> {
	const file = await readOwnerJson(
		join(directory, sessionEvidenceName(scope)),
	).catch(() => ({ contents: null }))
	if (!file) return undefined
	const summary = file.contents
	if (
		!Value.Check(sessionSchema, summary) ||
		summary.source !== scope.source ||
		summary.hostId !== scope.hostId ||
		summary.day !== scope.day
	)
		return null
	return summary
}
