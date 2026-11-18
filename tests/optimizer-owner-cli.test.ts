import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
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
	usage,
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
		{ status: 0, reports: [`${day}.complete.json`, `${day}.partial.json`] },
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
		{ day, keys: ['day', 'facts'], citation: { id: citation, value: 90 } },
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
	const { feed, profile, invoke } = await fixture(context)
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
})

void test('owner CLI refuses missing, fallback, mixed, or text-forged served-model metadata', async context => {
	const { profile, feed, reports, invoke } = await fixture(context)
	await writeFile(
		join(feed, `${day}.json`),
		JSON.stringify({ day, hosts: [approvedHost] }),
	)
	const alternate = {
		canonicalModel: 'claude-sonnet-5',
		provider: 'firstParty',
	}
	for (const modelUsage of [
		undefined,
		{ 'claude-sonnet-5': alternate },
		{ [model]: usage, 'claude-sonnet-5': alternate },
		{ [model]: { ...usage, provider: 'gateway' } },
		{ [model]: { ...usage, outputTokens: 0 } },
		{ [model]: { ...usage, canonicalModel: 'claude-sonnet-5' } },
	]) {
		writeResponse(modelUsage)
		const run = invoke()
		assert.equal(run.status, 1)
		assert.match(run.stderr, /served model/)
		assert.equal(run.stderr.includes('raw-child-text-canary'), false)
	}
	assert.deepStrictEqual(await readdir(reports), [])

	function writeResponse(modelUsage: unknown): void {
		writeFileSync(
			join(profile, 'response.json'),
			JSON.stringify({
				...response,
				modelUsage,
				result: JSON.stringify(response),
			}),
		)
	}
})
