import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { day } from './optimizer-owner-cli.ts'
import { installFixtureReader } from './optimizer-staged-reader.ts'

import type { SpawnSyncReturns } from 'node:child_process'

const exporter = fileURLToPath(
	new URL(
		'../../extensions/commands/usage/optimizer/export-owner-sessions.ts',
		import.meta.url,
	),
)
const metrics = Object.fromEntries(
	[
		'input',
		'output',
		'cacheRead',
		'cacheWrite',
		'reasoning',
		'durationMs',
		'estimateUsd',
	].map(metric => [metric, { sum: 10, missing: 0 }]),
)
const totals = { events: 1, failed: 0, unknownStatus: 0, metrics }

export function runExport(
	approvalPath: string,
	sessions: string,
): SpawnSyncReturns<string> {
	return spawnSync(
		process.execPath,
		[exporter, approvalPath, day, sessions],
		{
			encoding: 'utf8',
		},
	)
}

export async function configure(
	root: string,
	hosts: { hostId: string; approvedSources: string[] }[],
): Promise<{ snapshots: string; sessions: string }> {
	const snapshots = join(root, 'staged-snapshots')
	const sessions = join(root, 'staged-sessions')
	const configPath = join(root, 'owner.json')
	const { nativeClaude, reportDirectory, usageContract } = JSON.parse(
		await readFile(configPath, 'utf8'),
	)
	await mkdir(sessions)
	await writeFile(
		configPath,
		JSON.stringify({
			nativeClaude,
			reportDirectory,
			usageContract: {
				...usageContract,
				module: await installFixtureReader(root),
			},
			stagedEvidence: { snapshots, sessions },
			hosts,
		}),
	)
	return { snapshots, sessions }
}

export async function stageSnapshot(
	snapshots: string,
	enrolledHost: string,
	claimedHost = enrolledHost,
): Promise<void> {
	const directory = join(snapshots, 'usage', 'v1', enrolledHost)
	await mkdir(directory, { recursive: true })
	await writeFile(
		join(directory, `${day}.json`),
		JSON.stringify({
			version: 1,
			hostId: claimedHost,
			day,
			usage: { workload: totals, 'routing-overhead': totals },
		}),
	)
}
