import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { USAGE_CONTRACT_REVISION } from '../../extensions/commands/usage/optimizer/daily-usage.ts'

import type { SpawnSyncReturns } from 'node:child_process'
import type { TestContext } from 'node:test'

const entry = fileURLToPath(
	new URL(
		'../../extensions/commands/usage/optimizer/owner-cli.ts',
		import.meta.url,
	),
)
export const model = 'claude-fable-5-2'
const hostId = '0123456789abcdef0123456789abcdef'
const slot = '2025-10-26T00:00:00Z'
export const secondSlot = '2025-10-26T01:00:00Z'
export const day = '2025-10-25'
export const citation = `${hostId}.pi.inputTokens`
export const fakeOverride = 'optimizer-fixture-untrusted-value'
export const usage = {
	canonicalModel: model,
	provider: 'firstParty',
	outputTokens: 30,
}
export const response = {
	type: 'result',
	subtype: 'success',
	is_error: false,
	modelUsage: { [model]: usage },
	structured_output: { action: 'input-budget', sourceFacts: [citation] },
}
export const approvedHost = {
	hostId,
	snapshot: { hostId, day },
	sessions: [
		{
			hostId,
			day,
			source: 'pi',
			sessions: 1,
			turns: 2,
			compactions: 0,
			inputTokens: 90,
			outputTokens: 10,
		},
	],
}

const stub = `#!${process.execPath}
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
const profile = process.env.CLAUDE_CONFIG_DIR
appendFileSync(join(profile, 'calls'), JSON.stringify(args) + '\\n')
if (args[0] === '--version') {
  console.log('2.1.325 (Claude Code)')
} else if (args.join(' ') === 'auth status') {
  console.log(readFileSync(join(profile, 'auth.json'), 'utf8'))
} else {
  assert.deepEqual(readdirSync(process.cwd()), [])
  assert.equal(process.env.TMPDIR, process.cwd())
  const prompt = JSON.parse(readFileSync(0, 'utf8'))
  const reportDirectory = join(process.cwd(), '..', '..')
  const attempt = JSON.parse(readFileSync(join(reportDirectory, prompt.day + '.attempt.json'), 'utf8'))
  assert.equal(attempt.day, prompt.day)
  if (existsSync(join(profile, 'block-report'))) mkdirSync(join(reportDirectory, prompt.day + '.complete.json'))
  writeFileSync(join(profile, 'request.json'), JSON.stringify({ prompt, args, env: process.env, cwd: process.cwd() }))
  console.error('raw-child-text-canary')
  console.log(readFileSync(join(profile, 'response.json'), 'utf8'))
}
`

export async function fixture(context: TestContext): Promise<{
	root: string
	profile: string
	feed: string
	reports: string
	invoke: (intendedSlot?: string) => SpawnSyncReturns<string>
}> {
	const root = await mkdtemp(
		join(await realpath(tmpdir()), 'feat-nightly-usage-optimizer-owner-'),
	)
	context.after(() => rm(root, { recursive: true }))
	const profile = join(root, 'profile')
	const feed = join(root, 'feed')
	const reports = join(root, 'reports')
	await Promise.all(
		[profile, feed, reports].map(directory =>
			mkdir(directory, { mode: 0o700 }),
		),
	)
	const config = await writeOwnerFixture(root, profile, feed, reports)
	return {
		root,
		profile,
		feed,
		reports,
		invoke: intendedSlot => invokeOwner(root, config, intendedSlot),
	}
}

async function writeOwnerFixture(
	root: string,
	profile: string,
	feed: string,
	reports: string,
): Promise<string> {
	const claude = join(root, 'stub-cli.mjs')
	const decoder = join(root, 'usage-decoder.mjs')
	const config = join(root, 'owner.json')
	await Promise.all([
		writeFile(claude, stub, { mode: 0o700 }),
		writeFile(
			decoder,
			`export function decodeSnapshot(snapshot, hostId, day) {
			if (snapshot.hostId !== hostId || snapshot.day !== day || Object.keys(snapshot).length !== 2) throw Error('fixture snapshot mismatch');
			const workload = { events: 2, failed: 1, metrics: {} };
			return { usage: { workload, 'routing-overhead': workload } };
		}`,
		),
		writeFile(
			join(profile, 'auth.json'),
			JSON.stringify({
				authMethod: 'claude.ai',
				configDirectory: profile,
			}),
		),
		writeFile(join(profile, 'response.json'), JSON.stringify(response)),
		writeFile(join(root, 'CLAUDE.md'), fakeOverride),
		writeFile(
			config,
			JSON.stringify({
				feedDirectory: feed,
				reportDirectory: reports,
				usageContract: {
					revision: USAGE_CONTRACT_REVISION,
					module: decoder,
				},
				hosts: [{ hostId, approvedSources: ['pi'] }],
				nativeClaude: {
					executable: claude,
					home: root,
					configDirectory: profile,
					isPrintApproved: true,
				},
			}),
		),
	])
	return config
}

function invokeOwner(
	root: string,
	config: string,
	intendedSlot = slot,
): SpawnSyncReturns<string> {
	return spawnSync(process.execPath, [entry, config, intendedSlot], {
		cwd: root,
		encoding: 'utf8',
		env: {
			...process.env,
			ANTHROPIC_API_KEY: fakeOverride,
			ANTHROPIC_BASE_URL: fakeOverride,
			HTTPS_PROXY: fakeOverride,
			BASH_ENV: fakeOverride,
			CLAUDE_CONFIG_DIR: fakeOverride,
			CLAUDE_CODE_USE_BEDROCK: '1',
			PATH: fakeOverride,
			HOME: fakeOverride,
		},
	})
}
