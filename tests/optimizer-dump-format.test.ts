import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readApprovedDump } from '../extensions/commands/usage/optimizer/approved-dump.ts'
import { parseDumpEvidence } from '../extensions/commands/usage/optimizer/dump-evidence.ts'

import type { TestContext } from 'node:test'

const day = '2026-11-17'
const capturedAt = `${day}T01:00:00Z`
const capture = {
	capturedAt,
	runtime: {},
	prompt: {},
	inFlight: {},
	session: { id: 'session-1', header: { id: 'session-1' }, entries: [] },
}

function fixture(context: TestContext): Parameters<typeof readApprovedDump>[0] {
	const root = mkdtempSync(
		join(
			realpathSync(tmpdir()),
			'feat-nightly-usage-optimizer-dump-format-',
		),
	)
	context.after(() => rmSync(root, { recursive: true }))
	const filePath = join(root, 'session.json')
	const scope = {
		host: 'synthetic-host',
		source: 'pi-dump',
		file: filePath,
		operation: 'read',
	}
	return {
		permit: { ...scope, id: 'permit-7', expiresAt: `${day}T03:00:00Z` },
		expected: scope,
		filePath,
		day,
		now: `${day}T02:00:00Z`,
		consumePermit: async () => true,
	}
}

void test('dump parser rejects blank matching IDs and malformed message bodies or roles', () => {
	assert.throws(
		() =>
			parseDumpEvidence(
				{
					...capture,
					session: {
						...capture.session,
						id: '',
						header: { ...capture.session.header, id: '' },
					},
				},
				day,
			),
		/identity|fields/,
	)
	for (const body of [{}, { message: {} }, { message: { role: ' ' } }]) {
		const entries = [
			{ type: 'message', timestamp: capture.capturedAt, ...body },
		]
		assert.throws(
			() =>
				parseDumpEvidence(
					{ ...capture, session: { ...capture.session, entries } },
					day,
				),
			/message|fields/,
		)
	}
})

void test('approved dump refuses malformed UTF-8 in an otherwise opaque field', async context => {
	const input = fixture(context)
	const contents = JSON.stringify({ ...capture, prompt: 'BYTE_FIXTURE' })
		.split('BYTE_FIXTURE')
		.map(part => Buffer.from(part))
	const [before, after] = contents
	assert.ok(before && after)
	writeFileSync(
		input.filePath,
		Buffer.concat([before, Buffer.from([0xff]), after]),
	)
	assert.deepEqual(await readApprovedDump(input), {
		permitId: 'permit-7',
		status: 'denied',
		reason: 'file_refused',
	})
})
