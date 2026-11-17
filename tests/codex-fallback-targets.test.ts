import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent'

import { defaultConfig } from '../extensions/model/fallback/config.ts'
import { FallbackSession } from '../extensions/model/fallback/fallback-session.ts'
import { resolveFallbackChain } from '../extensions/model/fallback/targets.ts'

import type { TestContext } from 'node:test'

async function fixture(context: TestContext): Promise<{
	path: string
	registry: Pick<ModelRegistry, 'find' | 'hasConfiguredAuth'>
}> {
	const directory = mkdtempSync(join(tmpdir(), 'pi-codex-fallback-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: join(directory, 'models.json'),
		modelsStorePath: join(directory, 'models-store.json'),
		allowModelNetwork: false,
		refreshOnCreate: false,
	})
	const registry = new ModelRegistry(runtime)
	return {
		path: join(directory, 'providers.json'),
		registry: {
			find: (provider, id) => registry.find(provider, id),
			hasConfiguredAuth: () => true,
		},
	}
}

function putDeep(path: string, member: string): void {
	writeFileSync(
		path,
		JSON.stringify({ groups: [{ id: 'deep', members: [member] }] }),
	)
}

test('resolves a direct Codex target with the group effort and preserves the stored group reference', async context => {
	const { path, registry } = await fixture(context)
	putDeep(path, 'codex/gpt-6.1-sol:medium')
	const chain = ['codex-group/deep', 'openai-codex/gpt-6-luna']
	const warnings: string[] = []
	const targets = resolveFallbackChain(
		chain,
		registry,
		message => warnings.push(message),
		path,
	)
	assert.deepEqual(
		targets.map(({ reference, thinkingLevel }) => ({
			reference,
			thinkingLevel,
		})),
		[
			{ reference: 'openai-codex/gpt-6.1-sol', thinkingLevel: 'medium' },
			{ reference: 'openai-codex/gpt-6-luna', thinkingLevel: undefined },
		],
	)
	assert.deepEqual(chain, ['codex-group/deep', 'openai-codex/gpt-6-luna'])
	assert.deepEqual(warnings, [])
})

test('warns and retains the next direct target when Magpie configuration is missing', async context => {
	const { path, registry } = await fixture(context)
	const warnings: string[] = []
	const targets = resolveFallbackChain(
		['codex-group/deep', 'openai-codex/gpt-6-luna'],
		registry,
		message => warnings.push(message),
		path,
	)
	assert.deepEqual(
		targets.map(target => target.reference),
		['openai-codex/gpt-6-luna'],
	)
	assert.match(
		warnings.join('\n'),
		/skipped codex-group\/deep.*read valid Magpie groups/,
	)
})

test('warns when the derived model is absent from Pi and skips an unauthenticated group silently', async context => {
	const { path, registry } = await fixture(context)
	const warnings: string[] = []
	putDeep(path, 'codex/not-in-pi:medium')
	assert.deepEqual(
		resolveFallbackChain(
			['codex-group/deep'],
			registry,
			message => warnings.push(message),
			path,
		),
		[],
	)
	assert.deepEqual(warnings, [
		'Fallback: skipped codex-group/deep: openai-codex/not-in-pi not in the Pi model registry. Add its capability entry to models.pinned.json.',
	])
	putDeep(path, 'codex/gpt-6.1-sol:medium')
	const unsigned = { ...registry, hasConfiguredAuth: () => false }
	const silent: string[] = []
	assert.deepEqual(
		resolveFallbackChain(
			['codex-group/deep', 'inco/glm-5.3-flash:fast'],
			unsigned,
			message => silent.push(message),
			path,
		),
		[],
	)
	assert.deepEqual(silent, [])
})

test('applies cooldown and chain order to resolved identities after a Codex failure', async context => {
	const { path, registry } = await fixture(context)
	putDeep(path, 'codex/gpt-6.1-sol:medium')
	const targets = resolveFallbackChain(
		['codex-group/deep', 'openai-codex/gpt-6-luna'],
		registry,
		() => {},
		path,
	)
	const session = new FallbackSession(defaultConfig())
	session.coolDown(
		{ model: 'openai-codex/gpt-6.1-sol', reason: 'HTTP 502' },
		0,
	)
	assert.deepEqual(
		session.candidatesAfter(
			'openai-codex/gpt-6.1-sol',
			1,
			targets.map(target => target.reference),
		),
		['openai-codex/gpt-6-luna'],
	)
})

test('retains the original thinking level across fallback hops and clears it on session reset', () => {
	const session = new FallbackSession(defaultConfig())
	session.markFallbackActive('magpie/group/router', 'xhigh')
	session.markFallbackActive('openai-codex/gpt-6.1-sol', 'medium')
	assert.equal(session.restoreThinkingLevel(), 'xhigh')
	session.clearFallback()
	assert.equal(session.restoreThinkingLevel(), undefined)
	session.markFallbackActive('magpie/group/expert', 'high')
	session.startSession(defaultConfig())
	assert.equal(session.restoreThinkingLevel(), undefined)
})
