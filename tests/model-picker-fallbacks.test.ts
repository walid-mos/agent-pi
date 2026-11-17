import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent'

import { defaultConfig } from '../extensions/model/fallback/config.ts'
import { catalogRows } from '../extensions/model/fallback/model-catalog.ts'
import {
	activateRow,
	removeChainRow,
} from '../extensions/model/fallback/model-picker-commands.ts'
import { fallbackRows } from '../extensions/model/fallback/model-picker-fallbacks.ts'
import { initialPickerState } from '../extensions/model/fallback/model-picker-state.ts'
import { renderFallbacks } from '../extensions/model/fallback/model-picker-tabs.ts'
import { resolveFallbackChain } from '../extensions/model/fallback/targets.ts'

import type { TestContext } from 'node:test'
import type { PickerView } from '../extensions/model/fallback/model-picker-view.ts'

async function fixture(
	context: TestContext,
): Promise<ReturnType<typeof resolveFallbackChain>> {
	const directory = mkdtempSync(join(tmpdir(), 'pi-picker-fallbacks-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	const path = join(directory, 'providers.json')
	writeFileSync(
		path,
		JSON.stringify({
			groups: [{ id: 'fixture', members: ['codex/gpt-6.1-sol:medium'] }],
		}),
	)
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: join(directory, 'models.json'),
		modelsStorePath: join(directory, 'models-store.json'),
		allowModelNetwork: false,
		refreshOnCreate: false,
	})
	const registry = new ModelRegistry(runtime)
	const chain = ['codex-group/fixture', 'openai-codex/gpt-6-luna']
	return resolveFallbackChain(
		chain,
		{
			find: (provider, id) => registry.find(provider, id),
			hasConfiguredAuth: () => true,
		},
		assert.fail,
		path,
	)
}

function viewFor(targets: ReturnType<typeof resolveFallbackChain>): PickerView {
	return {
		rows: catalogRows({
			available: targets.map(target => target.model),
			scoped: [],
			current: undefined,
		}),
		currentReference: undefined,
		sessionLevel: 'high',
		scope: [],
		isScopeUnrestricted: true,
		startupDefault: undefined,
		patterns: [],
		isSettingsReadable: true,
		pricing: undefined,
		config: {
			...defaultConfig(),
			chain: targets.map(target => target.configuredReference),
		},
		agentPins: [],
		areAgentPinsKnown: true,
		roster: undefined,
		checkpointModel: undefined,
		cooldowns: new Map([['openai-codex/gpt-6.1-sol', 61_000]]),
		now: 1_000,
		fallbackReferences: new Map(
			targets.map(target => [
				target.configuredReference,
				target.reference,
			]),
		),
	}
}

test('a group chain row shows its resolved model cooldown without offering that model twice', async context => {
	const view = viewFor(await fixture(context))
	assert.deepEqual(
		fallbackRows(view).filter(row => row.kind === 'candidate'),
		[],
	)
	const lines = renderFallbacks({
		view,
		state: { ...initialPickerState(), tab: 'fallbacks' },
		query: '',
		editorQuery: '',
		searchLine: '',
		size: { width: 100, height: 30 },
	})
	assert.match(
		lines.map(line => line.text).join('\n'),
		/codex-group\/fixture.*cooling 1m/,
	)
	assert.deepEqual(view.config.chain, [
		'codex-group/fixture',
		'openai-codex/gpt-6-luna',
	])
})

test('removing a group makes its resolved model available to append as a direct entry', async context => {
	const view = viewFor(await fixture(context))
	const state = { ...initialPickerState(), tab: 'fallbacks' as const }
	const removed = removeChainRow({ view, state, query: '' })
	assert.ok(removed.config)
	const next = { ...view, config: removed.config }
	assert.deepEqual(
		fallbackRows(next).filter(row => row.kind === 'candidate'),
		[{ kind: 'candidate', reference: 'openai-codex/gpt-6.1-sol' }],
	)
	const appended = activateRow({
		view: next,
		state: { ...state, cursor: 1 },
		query: '',
	})
	assert.deepEqual(appended.config?.chain, [
		'openai-codex/gpt-6-luna',
		'openai-codex/gpt-6.1-sol',
	])
})
