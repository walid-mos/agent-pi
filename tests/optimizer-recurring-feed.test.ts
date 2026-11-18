import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { approvedHost, day, fixture } from './fixtures/optimizer-owner-cli.ts'

import type { SpawnSyncReturns } from 'node:child_process'

const exporter = fileURLToPath(
	new URL(
		'../extensions/commands/usage/optimizer/export-owner-sessions.ts',
		import.meta.url,
	),
)
const previousDay = '2025-10-24'
const { hostId } = approvedHost

function collect(
	config: string,
	utcDay: string,
	staging: string,
	now?: string,
): SpawnSyncReturns<string> {
	const preload = `import {mock} from 'node:test'; mock.timers.enable({apis:['Date'],now:Date.parse(${JSON.stringify(now)})})`
	const flags = now
		? ['--import', `data:text/javascript,${encodeURIComponent(preload)}`]
		: []
	return spawnSync(
		process.execPath,
		[...flags, exporter, config, utcDay, staging],
		{ encoding: 'utf8' },
	)
}

function piRecord(utcDay: string, input: number): string {
	return JSON.stringify({
		type: 'message',
		id: `response-${utcDay}`,
		timestamp: `${utcDay}T23:00:00Z`,
		message: {
			role: 'assistant',
			usage: { input, output: 5 },
			content: 'synthetic transcript not for handoff',
		},
	})
}

void test('one approved Pi project directory produces distinct daily aggregates from the same config', async context => {
	const { root } = await fixture(context)
	const approved = join(root, 'project')
	const unapproved = join(approved, 'nested')
	const staging = join(root, 'staging')
	const config = join(root, 'collector.json')
	await mkdir(unapproved, { recursive: true })
	await mkdir(staging)
	await writeFile(
		config,
		JSON.stringify({ hostId, source: 'pi', directories: [approved] }),
	)
	await writeFile(
		join(approved, 'session.jsonl'),
		[
			JSON.stringify({ type: 'session', id: 'pi-session' }),
			piRecord(previousDay, 35),
			piRecord(day, 70),
		].join('\n'),
	)
	await writeFile(
		join(unapproved, 'ignored.jsonl'),
		'not an approved session',
	)
	await writeFile(join(approved, 'session.json'), 'not a supported source')
	const expectedDays = [
		{ utcDay: previousDay, inputTokens: 35 },
		{ utcDay: day, inputTokens: 70, now: '2025-10-26T01:05:00Z' },
	]
	await Promise.all(
		expectedDays.map(async ({ utcDay, inputTokens, now }) => {
			const run = collect(
				config,
				now ? '--scheduled' : utcDay,
				staging,
				now,
			)
			assert.equal(run.status, 0, run.stderr)
			const aggregate = await readFile(
				join(staging, `${hostId}.${utcDay}.pi.json`),
				'utf8',
			)
			assert.deepEqual(JSON.parse(aggregate), {
				hostId,
				day: utcDay,
				source: 'pi',
				sessions: 1,
				turns: 1,
				compactions: 0,
				inputTokens,
				outputTokens: 5,
			})
		}),
	)
})

void test('Pi export counts copied native sessions once and refuses conflicting copies in either file order', async context => {
	const { root } = await fixture(context)
	const config = join(root, 'approved.json')
	const first = join(root, 'first.jsonl')
	const second = join(root, 'second.jsonl')
	const staging = join(root, 'staging')
	const header = JSON.stringify({ type: 'session', id: 'pi-session' })
	await mkdir(staging)
	await Promise.all(
		[first, second].map(file =>
			writeFile(file, [header, piRecord(day, 70)].join('\n')),
		),
	)
	await writeFile(
		config,
		JSON.stringify({ hostId, source: 'pi', day, files: [first, second] }),
	)
	const run = collect(config, day, staging)
	assert.equal(run.status, 0, run.stderr)
	assert.deepEqual(
		JSON.parse(
			await readFile(join(staging, `${hostId}.${day}.pi.json`), 'utf8'),
		),
		{
			hostId,
			day,
			source: 'pi',
			sessions: 1,
			turns: 1,
			compactions: 0,
			inputTokens: 70,
			outputTokens: 5,
		},
	)
	await writeFile(second, [header, piRecord(day, 85)].join('\n'))
	await Promise.all(
		[
			[first, second],
			[second, first],
		].map(async (files, index) => {
			const approval = join(root, `conflict-${index}.json`)
			const outbox = join(root, `outbox-${index}`)
			await mkdir(outbox)
			await writeFile(
				approval,
				JSON.stringify({ hostId, source: 'pi', day, files }),
			)
			assert.equal(collect(approval, day, outbox).status, 1)
			await assert.rejects(
				readFile(join(outbox, `${hostId}.${day}.pi.json`)),
				{ code: 'ENOENT' },
			)
		}),
	)
})

void test('recurring Claude export accepts native measurements and refuses a linked JSONL input', async context => {
	const { root } = await fixture(context)
	const approved = join(root, 'project')
	const staging = join(root, 'staging')
	const config = join(root, 'collector.json')
	const transcript = join(approved, 'session.jsonl')
	await mkdir(approved)
	await mkdir(staging)
	await writeFile(
		config,
		JSON.stringify({
			hostId,
			source: 'claude-code',
			directories: [approved],
		}),
	)
	await writeFile(
		transcript,
		JSON.stringify({
			type: 'assistant',
			timestamp: `${day}T03:00:00Z`,
			sessionId: 'claude-session',
			uuid: 'claude-record',
			message: {
				id: 'msg_fixture',
				role: 'assistant',
				usage: { input_tokens: 40, output_tokens: 8 },
			},
		}),
	)
	const aggregate = join(staging, `${hostId}.${day}.claude-code.json`)
	await symlink(transcript, join(approved, 'linked.jsonl'))
	assert.equal(collect(config, day, staging).status, 1)
	await assert.rejects(readFile(aggregate), { code: 'ENOENT' })
	const clean = join(root, 'clean-project')
	await mkdir(clean)
	await writeFile(join(clean, 'session.jsonl'), await readFile(transcript))
	await writeFile(
		config,
		JSON.stringify({ hostId, source: 'claude-code', directories: [clean] }),
	)
	const run = collect(config, day, staging)
	assert.equal(run.status, 0, run.stderr)
	assert.deepEqual(JSON.parse(await readFile(aggregate, 'utf8')), {
		hostId,
		day,
		source: 'claude-code',
		sessions: 1,
		turns: 1,
		compactions: 0,
		inputTokens: 40,
		outputTokens: 8,
	})
})
