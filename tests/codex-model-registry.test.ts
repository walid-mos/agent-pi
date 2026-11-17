import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
	getSupportedThinkingLevels,
	InMemoryCredentialStore,
} from '@earendil-works/pi-ai'
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent'

import type { TestContext } from 'node:test'

async function registry(
	context: TestContext,
	modelsPath: string | null,
): Promise<ModelRegistry> {
	const directory = mkdtempSync(join(tmpdir(), 'pi-codex-registry-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath,
		modelsStorePath: join(directory, 'models-store.json'),
		allowModelNetwork: false,
		refreshOnCreate: false,
	})
	return new ModelRegistry(runtime)
}

test('Pi resolves direct GPT-6.2 Sol from the capability catalog without network or sign-in', async context => {
	const builtin = await registry(context, null)
	assert.equal(builtin.find('openai-codex', 'gpt-6.2-sol'), undefined)
	const configured = await registry(context, resolve('models.pinned.json'))
	assert.equal(configured.getError(), undefined)
	const model = configured.find('openai-codex', 'gpt-6.2-sol')
	assert.ok(
		model,
		'the repository capability catalog must register the new Codex model',
	)
	assert.equal(model.api, 'openai-codex-responses')
	assert.equal(model.baseUrl, 'https://chatgpt.com/backend-api')
	assert.equal(model.contextWindow, 500_000)
	assert.equal(model.maxTokens, 128_000)
	assert.deepEqual(getSupportedThinkingLevels(model), [
		'minimal',
		'low',
		'medium',
		'high',
		'xhigh',
		'max',
	])
	assert.equal(
		configured.find('openai-codex', 'gpt-6.1-sol')?.api,
		'openai-codex-responses',
	)
})
