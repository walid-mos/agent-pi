import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { fixture } from './fixtures/optimizer-owner-cli.ts'

const ownerCli = fileURLToPath(
	new URL(
		'../extensions/commands/usage/optimizer/owner-cli.ts',
		import.meta.url,
	),
)
const slots = [
	[
		'2025-07-12T00:00:00Z',
		'2025-07-12T00:00:00.000Z',
		'2025-07-11',
		'regular',
	],
	[
		'2025-07-12T16:40:00Z',
		'2025-07-12T00:00:00.000Z',
		'2025-07-11',
		'regular',
	],
	[
		'2025-03-30T01:12:00Z',
		'2025-03-30T01:00:00.000Z',
		'2025-03-29',
		'spring-gap-recovery',
	],
	[
		'2025-10-26T00:05:00Z',
		'2025-10-26T00:00:00.000Z',
		'2025-10-25',
		'autumn-fold-first',
	],
	[
		'2025-10-26T01:05:00Z',
		'2025-10-26T00:00:00.000Z',
		'2025-10-25',
		'autumn-fold-first',
	],
] as const

for (const [now, intendedSlot, day, slot] of slots) {
	void test(`owner job resolves ${slot} input at ${now} and records missing coverage`, async context => {
		const { root, reports, profile } = await fixture(context)
		const preload = `import {mock} from 'node:test'; mock.timers.enable({apis:['Date'],now:Date.parse(${JSON.stringify(now)})})`
		const run = spawnSync(
			process.execPath,
			[
				'--import',
				`data:text/javascript,${encodeURIComponent(preload)}`,
				ownerCli,
				join(root, 'owner.json'),
				'--scheduled',
			],
			{ encoding: 'utf8' },
		)
		assert.equal(run.status, 0, run.stderr)
		const report = JSON.parse(
			await readFile(join(reports, `${day}.partial.json`), 'utf8'),
		)
		assert.deepStrictEqual(
			{
				day: report.day,
				slot: report.slot,
				intendedSlot: report.intendedSlot,
			},
			{ day, slot, intendedSlot },
		)
		await assert.rejects(readFile(join(profile, 'calls')), {
			code: 'ENOENT',
		})
	})
}
