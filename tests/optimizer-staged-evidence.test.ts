import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
	approvedHost,
	day,
	fixture,
	secondSlot,
} from './fixtures/optimizer-owner-cli.ts'
import {
	configure,
	runExport,
	stageSnapshot,
} from './fixtures/optimizer-staged-input.ts'

const { hostId } = approvedHost
const otherHost = '1123456789abcdef0123456789abcdef'
const canary = 'fixture transcript stays in the owning directory'
const approval = { hostId, day, source: 'pi' }
const roster = [hostId, otherHost].map(id => ({
	hostId: id,
	approvedSources: ['pi'],
}))

async function exportEvidence(root: string, sessions: string): Promise<void> {
	const project = join(root, 'approved-project')
	const file = join(project, 'approved.jsonl')
	const manifest = join(root, 'collector.json')
	await mkdir(project)
	const entry = {
		type: 'message',
		id: 'pi-response',
		timestamp: `${day}T03:00:00Z`,
		message: {
			role: 'assistant',
			usage: { input: 90, output: 10 },
			content: canary,
		},
	}
	await writeFile(
		file,
		[
			JSON.stringify({ type: 'session', id: 'pi-session' }),
			JSON.stringify(entry),
		].join('\n'),
	)
	await writeFile(
		manifest,
		JSON.stringify({ hostId, source: 'pi', directories: [project] }),
	)
	const run = runExport(manifest, sessions)
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

async function stageEmptySource(sessions: string): Promise<void> {
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
}

void test('exporter leaves metadata-only, malformed, and ambiguous measurements missing without print', async context => {
	const { root, reports, profile, invoke } = await fixture(context)
	const { snapshots, sessions } = await configure(root, roster)
	await stageSnapshot(snapshots, hostId)
	await stageSnapshot(snapshots, otherHost)
	await stageEmptySource(sessions)
	const manifest = join(root, 'manifest.json')
	const file = join(root, 'approved.jsonl')
	await writeFile(manifest, JSON.stringify({ ...approval, files: [file] }))
	await writeFile(file, JSON.stringify({ type: 'session', id: 'header' }))
	const skipped = runExport(manifest, sessions)
	assert.equal(skipped.status, 0, skipped.stderr)
	const aggregate = join(sessions, `${hostId}.${day}.pi.json`)
	await assert.rejects(readFile(aggregate), { code: 'ENOENT' })
	await writeFile(
		file,
		JSON.stringify({
			type: 'message',
			timestamp: 'invalid',
			message: { role: 'assistant', usage: { input: 300, output: 100 } },
		}),
	)
	const refused = runExport(manifest, sessions)
	assert.equal(refused.status, 1, refused.stderr)
	const conflictingEntries = [
		{ type: 'session', id: 'session' },
		...[300, 301].map(input => ({
			type: 'message',
			id: 'response',
			timestamp: `${day}T01:00:00Z`,
			message: { role: 'assistant', usage: { input, output: 100 } },
		})),
	]
	await writeFile(
		file,
		conflictingEntries.map(entry => JSON.stringify(entry)).join('\n'),
	)
	const ambiguous = runExport(manifest, sessions)
	assert.equal(ambiguous.status, 1, ambiguous.stderr)
	await assert.rejects(readFile(aggregate), { code: 'ENOENT' })
	const partial = invoke()
	assert.equal(partial.status, 0, partial.stderr)
	const report = JSON.parse(
		await readFile(join(reports, `${day}.partial.json`), 'utf8'),
	)
	assert.deepEqual(report.coverage, [
		{ hostId, usage: 'valid', sessions: 'missing' },
		{ hostId: otherHost, usage: 'valid', sessions: 'valid' },
	])
	await assert.rejects(readFile(join(profile, 'calls')), { code: 'ENOENT' })
	await assert.rejects(readFile(join(reports, `${day}.attempt.json`)), {
		code: 'ENOENT',
	})
})

void test('owner job joins exact staged snapshots and local session aggregates, then retries the same day', async context => {
	const { root, reports, profile, invoke } = await fixture(context)
	const { snapshots, sessions } = await configure(root, roster)
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
	await stageEmptySource(sessions)
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
