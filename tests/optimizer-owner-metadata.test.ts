import assert from 'node:assert/strict'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
	approvedHost,
	day,
	fixture,
	model,
	response,
	usage,
} from './fixtures/optimizer-owner-cli.ts'

const alternate = { canonicalModel: 'claude-sonnet-5', provider: 'firstParty' }
const invalidUsage = {
	'missing despite text claim': undefined,
	fallback: { 'claude-sonnet-5': alternate },
	mixed: { [model]: usage, 'claude-sonnet-5': alternate },
	gateway: { [model]: { ...usage, provider: 'gateway' } },
	'zero output': { [model]: { ...usage, outputTokens: 0 } },
	'wrong canonical model': {
		[model]: { ...usage, canonicalModel: 'claude-sonnet-5' },
	},
}
for (const [scenario, modelUsage] of Object.entries(invalidUsage)) {
	void test(`owner CLI refuses ${scenario} served-model metadata`, async context => {
		const { profile, feed, reports, invoke } = await fixture(context)
		await writeFile(
			join(feed, `${day}.json`),
			JSON.stringify({ day, hosts: [approvedHost] }),
		)
		await writeFile(
			join(profile, 'response.json'),
			JSON.stringify({
				...response,
				modelUsage,
				result: JSON.stringify(response),
			}),
		)
		const run = invoke()
		assert.match(run.stderr, /served model/)
		assert.deepStrictEqual(
			{
				status: run.status,
				hasRawOutput: run.stderr.includes('raw-child-text-canary'),
				reports: await readdir(reports),
			},
			{
				status: 1,
				hasRawOutput: false,
				reports: [`${day}.attempt.json`],
			},
		)
	})
}
