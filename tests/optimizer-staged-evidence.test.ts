import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
	approvedHost,
	day,
	fixture,
	secondSlot,
} from './fixtures/optimizer-owner-cli.ts'

const exporter = fileURLToPath(
	new URL(
		'../extensions/commands/usage/optimizer/export-owner-sessions.ts',
		import.meta.url,
	),
)
const { hostId } = approvedHost
const otherHost = '1123456789abcdef0123456789abcdef'
const canary = 'fixture transcript stays in the owning directory'
const approval = { hostId, day, source: 'pi' }
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

async function exportEvidence(root: string, sessions: string): Promise<void> {
	const file = join(root, 'approved.jsonl')
	const manifest = join(root, 'manifest.json')
	const entry = {
		type: 'message',
		timestamp: `${day}T03:00:00Z`,
		message: {
			role: 'assistant',
			usage: { input: 90, output: 10 },
			content: canary,
		},
	}
	await writeFile(file, `${JSON.stringify(entry)}\n`)
	await writeFile(manifest, JSON.stringify({ ...approval, files: [file] }))
	const run = spawnSync(
		process.execPath,
		[exporter, manifest, day, sessions],
		{ encoding: 'utf8' },
	)
	assert.equal(run.status, 0, run.stderr)
	const contents = await readFile(
		join(sessions, `${hostId}.${day}.pi.json`),
		'utf8',
	)
	assert.deepStrictEqual(JSON.parse(contents), {
		...approval,
		sessions: 1,
		turns: 1,
		compactions: 0,
		inputTokens: 90,
		outputTokens: 10,
	})
}

async function installFixtureReader(root: string): Promise<string> {
	const pinned = process.env.NIGHTLY_USAGE_PINNED_PIPELINE
	if (pinned) return join(pinned, 'dailySnapshot.ts')
	const decoder = join(root, 'dailySnapshot.ts')
	await writeFile(
		decoder,
		'export const SNAPSHOT_LIMIT = 8192; export function decodeSnapshot() { throw Error("Use the staged publication reader") }',
	)
	await writeFile(
		join(root, 'readDailyPublication.ts'),
		`export async function readDailyPublication(store, roster, day) {
		return { day, hosts: await Promise.all(roster.map(async ({hostId}) => {
			const stored = await store.get(\`usage/v1/\${hostId}/\${day}.json\`);
			if (!stored) return {hostId, status: 'missing'};
			try { const snapshot = await new Response(stored.body).json(); return snapshot.hostId === hostId && snapshot.day === day ? {hostId, status: 'delivered', usage: snapshot.usage} : {hostId, status: 'invalid'}; }
			catch { return {hostId, status: 'invalid'}; }
		})) }
	}`,
	)
	return decoder
}

async function configure(
	root: string,
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
			hosts: [hostId, otherHost].map(id => ({
				hostId: id,
				approvedSources: ['pi'],
			})),
		}),
	)
	return { snapshots, sessions }
}

async function stageSnapshot(
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

void test('owner job joins exact staged snapshots and local session aggregates, then retries the same day', async context => {
	const { root, reports, profile, invoke } = await fixture(context)
	const { snapshots, sessions } = await configure(root)
	await exportEvidence(root, sessions)
	await stageSnapshot(snapshots, hostId, otherHost)
	const partial = invoke()
	assert.equal(partial.status, 0, partial.stderr)
	const report = JSON.parse(
		await readFile(join(reports, `${day}.partial.json`), 'utf8'),
	)
	assert.deepStrictEqual(report.coverage, [
		{ hostId, usage: 'invalid', sessions: 'valid' },
		{ hostId: otherHost, usage: 'missing', sessions: 'missing' },
	])
	await assert.rejects(readFile(join(profile, 'calls')), { code: 'ENOENT' })
	await stageSnapshot(snapshots, hostId)
	await stageSnapshot(snapshots, otherHost)
	await writeFile(
		join(sessions, `${otherHost}.${day}.pi.json`),
		JSON.stringify({
			...approval,
			hostId: otherHost,
			sessions: 0,
			turns: 0,
			compactions: 0,
			inputTokens: 0,
			outputTokens: 0,
		}),
	)
	const retried = invoke(secondSlot)
	assert.equal(retried.status, 0, retried.stderr)
	const complete = JSON.parse(
		await readFile(join(reports, `${day}.complete.json`), 'utf8'),
	)
	const request = await readFile(join(profile, 'request.json'), 'utf8')
	assert.deepStrictEqual(
		{
			day: complete.day,
			status: complete.status,
			hasTranscript: request.includes(canary),
			hasWorkload: request.includes(`${otherHost}.workload.events`),
		},
		{ day, status: 'complete', hasTranscript: false, hasWorkload: true },
	)
})
