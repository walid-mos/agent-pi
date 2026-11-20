import assert from 'node:assert/strict'
import { readFile, readdir, rename, rmdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
	approvedHost,
	citation,
	day,
	fakeOverride,
	fixture,
	model,
	response,
	secondSlot,
} from './fixtures/optimizer-owner-cli.ts'

void test('owner CLI retries the intended day, sends only approved aggregates, and skips a completed fold', async context => {
	const { profile, feed, reports, root, invoke } = await fixture(context)
	const partial = invoke()
	assert.deepStrictEqual(
		{ status: partial.status, reports: await readdir(reports) },
		{ status: 0, reports: [`${day}.partial.json`] },
		partial.stderr,
	)
	await assert.rejects(readFile(join(profile, 'calls')), { code: 'ENOENT' })
	await writeFile(
		join(feed, `${day}.json`),
		JSON.stringify({ day, hosts: [approvedHost] }),
	)
	const complete = invoke()
	assert.deepStrictEqual(
		{ status: complete.status, reports: await readdir(reports) },
		{
			status: 0,
			reports: [
				`${day}.attempt.json`,
				`${day}.complete.json`,
				`${day}.partial.json`,
			],
		},
		complete.stderr,
	)
	const execution = await readFile(join(profile, 'request.json'), 'utf8')
	const {
		args,
		env,
		prompt,
		cwd,
	}: {
		args: string[]
		env: NodeJS.ProcessEnv
		prompt: { day: string; facts: { id: string; value: number }[] }
		cwd: string
	} = JSON.parse(execution)
	for (const [flag, value] of Object.entries({
		'--model': model,
		'--tools': '',
		'--output-format': 'json',
		'--permission-mode': 'dontAsk',
		'--disallowedTools': 'mcp__*',
	}))
		assert.equal(args[args.indexOf(flag) + 1], value, flag)
	for (const flag of [
		'--print',
		'--safe-mode',
		'--restricted',
		'--no-session-persistence',
		'--strict-mcp-config',
		'--no-chrome',
	])
		assert.ok(args.includes(flag), flag)
	assert.equal(args.includes('--bare'), false)
	assert.deepStrictEqual(
		JSON.parse(args[args.indexOf('--mcp-config') + 1] ?? ''),
		{
			mcpServers: {},
		},
	)
	assert.equal(
		JSON.parse(args[args.indexOf('--settings') + 1] ?? '')
			.disableClaudeAiConnectors,
		true,
	)
	assert.equal(env.HOME, root)
	assert.equal(env.CLAUDE_CODE_SKIP_PROMPT_HISTORY, '1')
	assert.deepStrictEqual(
		{
			day: prompt.day,
			keys: Object.keys(prompt).toSorted(),
			citation: prompt.facts.find(fact => fact.id === citation),
		},
		{
			day,
			keys: ['actions', 'day', 'facts'],
			citation: { id: citation, value: 90 },
		},
	)
	assert.equal(execution.includes(fakeOverride), false)
	assert.equal(complete.stderr.includes('raw-child-text-canary'), false)
	await assert.rejects(readdir(cwd), { code: 'ENOENT' })
	const calls = await readFile(join(profile, 'calls'), 'utf8')
	const duplicate = invoke(secondSlot)
	assert.deepStrictEqual(
		{
			status: duplicate.status,
			calls: await readFile(join(profile, 'calls'), 'utf8'),
		},
		{ status: 0, calls },
	)
})

void test('owner CLI rejects feed-supplied approval and raw session fields before invoking Claude', async context => {
	const { profile, feed, invoke } = await fixture(context)
	const handoff = join(feed, `${day}.json`)
	await writeFile(
		handoff,
		JSON.stringify({
			day,
			hosts: [{ ...approvedHost, approvedSources: ['pi'] }],
		}),
	)
	assert.match(invoke().stderr, /aggregate handoff/)
	await writeFile(
		handoff,
		JSON.stringify({
			day,
			hosts: [
				{
					...approvedHost,
					sessions: [
						{
							...approvedHost.sessions[0],
							transcript: fakeOverride,
						},
					],
				},
			],
		}),
	)
	assert.equal(invoke().status, 0)
	await assert.rejects(readFile(join(profile, 'calls')), { code: 'ENOENT' })
})

void test('owner CLI refuses a non-subscription auth status before submitting a prompt', async context => {
	const { feed, profile, reports, invoke } = await fixture(context)
	await writeFile(
		join(feed, `${day}.json`),
		JSON.stringify({ day, hosts: [approvedHost] }),
	)
	await writeFile(
		join(profile, 'auth.json'),
		JSON.stringify({ authMethod: 'api_key', configDirectory: profile }),
	)
	const run = invoke()
	assert.equal(run.status, 1)
	assert.match(run.stderr, /subscription sign-in/)
	await assert.rejects(readFile(join(profile, 'request.json')), {
		code: 'ENOENT',
	})
	assert.deepStrictEqual(await readdir(reports), [])
	await writeFile(
		join(profile, 'auth.json'),
		JSON.stringify({ authMethod: 'claude.ai', configDirectory: profile }),
	)
	const retry = invoke(secondSlot)
	assert.equal(retry.status, 0, retry.stderr)
})

void test('owner CLI blocks a second print for the UTC day after rejecting the first result', async context => {
	const { feed, profile, invoke } = await fixture(context)
	await writeFile(
		join(feed, `${day}.json`),
		JSON.stringify({ day, hosts: [approvedHost] }),
	)
	await writeFile(
		join(profile, 'response.json'),
		JSON.stringify({ ...response, modelUsage: {} }),
	)
	const rejected = invoke()
	const retry = invoke(secondSlot)
	const calls = await readFile(join(profile, 'calls'), 'utf8')
	assert.deepStrictEqual(
		{
			first: rejected.status,
			retry: retry.status,
			printLaunches: calls.match(/"--print"/g)?.length,
		},
		{ first: 1, retry: 1, printLaunches: 1 },
	)
	assert.match(rejected.stderr, /served model/)
	assert.match(retry.stderr, /owner recovery/)
})

void test('owner CLI blocks an ambiguous marker until the owner archives it', async context => {
	const { feed, profile, reports, root, invoke } = await fixture(context)
	await writeFile(
		join(feed, `${day}.json`),
		JSON.stringify({ day, hosts: [approvedHost] }),
	)
	const marker = join(reports, `${day}.attempt.json`)
	await writeFile(marker, '')
	const blocked = invoke()
	assert.match(blocked.stderr, /owner recovery/)
	await assert.rejects(readFile(join(profile, 'calls')), { code: 'ENOENT' })
	await rename(marker, join(root, 'archived-attempt.json'))
	const resumed = invoke()
	assert.deepStrictEqual(
		{
			blocked: blocked.status,
			resumed: resumed.status,
			reports: await readdir(reports),
		},
		{
			blocked: 1,
			resumed: 0,
			reports: [`${day}.attempt.json`, `${day}.complete.json`],
		},
		resumed.stderr,
	)
})

void test('owner CLI blocks a retry after report publication fails', async context => {
	const { feed, profile, reports, invoke } = await fixture(context)
	await writeFile(
		join(feed, `${day}.json`),
		JSON.stringify({ day, hosts: [approvedHost] }),
	)
	await writeFile(join(profile, 'block-report'), '')
	const first = invoke()
	assert.match(first.stderr, /EEXIST|EISDIR/)
	await rmdir(join(reports, `${day}.complete.json`))
	const retry = invoke()
	assert.match(retry.stderr, /owner recovery/)
	const calls = await readFile(join(profile, 'calls'), 'utf8')
	assert.deepStrictEqual(
		{
			first: first.status,
			retry: retry.status,
			printLaunches: calls.match(/"--print"/g)?.length,
			reports: await readdir(reports),
		},
		{
			first: 1,
			retry: 1,
			printLaunches: 1,
			reports: [`${day}.attempt.json`],
		},
	)
})
