import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
	approvedHost,
	day,
	fixture,
	response,
} from './fixtures/optimizer-owner-cli.ts'
import {
	configure,
	runExport,
	stageSnapshot,
} from './fixtures/optimizer-staged-input.ts'

const { hostId } = approvedHost
const source = 'claude-code'
const record = {
	type: 'assistant',
	sessionId: 'session-one',
	uuid: 'record-one',
	requestId: 'req_one',
	timestamp: `${day}T02:00:00Z`,
	message: {
		id: 'msg_one',
		role: 'assistant',
		usage: { input_tokens: 19, output_tokens: 23 },
	},
}
const conflictingCopy = {
	...record,
	requestId: 'req_two',
	message: {
		id: 'msg_two',
		role: 'assistant',
		usage: { input_tokens: 61, output_tokens: 71 },
	},
}

for (const order of [
	[record, conflictingCopy],
	[conflictingCopy, record],
]) {
	void test(`collector refuses conflicting Claude Code UUID copies starting with ${order[0]?.requestId} and nightly skips print`, async context => {
		const { root, reports, profile, invoke } = await fixture(context)
		const { snapshots, sessions } = await configure(root, [
			{ hostId, approvedSources: [source] },
		])
		await stageSnapshot(snapshots, hostId)
		const files = order.map((_, index) =>
			join(root, `approved-${index}.jsonl`),
		)
		await Promise.all(
			order.map((entry, index) =>
				writeFile(
					join(root, `approved-${index}.jsonl`),
					JSON.stringify(entry),
				),
			),
		)
		const approval = join(root, 'approval.json')
		await writeFile(
			approval,
			JSON.stringify({ hostId, day, source, files }),
		)
		await writeFile(
			join(profile, 'response.json'),
			JSON.stringify({
				...response,
				structured_output: {
					...response.structured_output,
					sourceFacts: [
						`${hostId}.${source}.inputTokens`,
						`${hostId}.${source}.turns`,
					],
				},
			}),
		)
		const exported = runExport(approval, sessions)
		const nightly = invoke()
		assert.equal(nightly.status, 0, nightly.stderr)
		await assert.rejects(readFile(join(profile, 'calls')), {
			code: 'ENOENT',
		})
		assert.equal(exported.status, 1, exported.stderr)
		await assert.rejects(
			readFile(join(sessions, `${hostId}.${day}.${source}.json`)),
			{ code: 'ENOENT' },
		)
		const report = JSON.parse(
			await readFile(join(reports, `${day}.partial.json`), 'utf8'),
		)
		assert.deepEqual(
			{ status: report.status, coverage: report.coverage },
			{
				status: 'partial',
				coverage: [{ hostId, usage: 'valid', sessions: 'missing' }],
			},
		)
		await assert.rejects(readFile(join(reports, `${day}.attempt.json`)), {
			code: 'ENOENT',
		})
	})
}
