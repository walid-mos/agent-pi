import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from '@earendil-works/pi-coding-agent'

import { secretHandoff } from '../extensions/ui/ask-user-secret/secret-store.ts'
import { parseSecretResult } from '../extensions/ui/ask-user-secret/transcript.ts'

import { browserOrigin, syntheticSecret } from './fixtures/secret-broker.ts'

import type { TestContext } from 'node:test'
import type { ExtensionRunner } from '@earendil-works/pi-coding-agent'

const TERMINAL_PROMPT = 'terminal-only secret prompt opened'
const CALL = 'call-1'
const browserSecret = {
	kind: 'token',
	purpose: 'Fixture page sign-in',
	destination: 'browser',
	origin: browserOrigin,
}

function extensionPath(name: string): string {
	return fileURLToPath(
		new URL(`../extensions/ui/${name}/index.ts`, import.meta.url),
	)
}

function pageBrokerScript(context: TestContext): string {
	process.env.PAGE_BROKER_ENTRY = syntheticSecret
	context.after(() =>
		Reflect.deleteProperty(process.env, 'PAGE_BROKER_ENTRY'),
	)
	return fileURLToPath(new URL('./fixtures/page-broker.mjs', import.meta.url))
}

async function loadedTools(
	context: TestContext,
	flags: (root: string) => Promise<Record<string, string>>,
): Promise<ExtensionRunner> {
	const root = await mkdtemp(join(tmpdir(), 'pi-worker-secret-'))
	context.after(() => rm(root, { recursive: true, force: true }))
	const agentDir = join(root, 'agent')
	const resourceLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noContextFiles: true,
		additionalExtensionPaths: [
			extensionPath('ask-user-question'),
			extensionPath('ask-user-secret'),
		],
	})
	await resourceLoader.reload()
	const { session } = await createAgentSession({
		cwd: root,
		agentDir,
		resourceLoader,
		settingsManager: SettingsManager.inMemory(),
		sessionManager: SessionManager.create(root, join(root, 'sessions')),
	})
	context.after(() => session.dispose())
	const runner = session.extensionRunner
	for (const [name, value] of Object.entries(await flags(root)))
		runner.setFlagValue(name, value)
	runner.setUIContext(
		{
			...runner.getUIContext(),
			custom: () => Promise.reject(new Error(TERMINAL_PROMPT)),
		},
		'tui',
	)
	return runner
}

async function askBrowserSecret(runner: ExtensionRunner): Promise<unknown> {
	const tool = runner.getToolDefinition('ask_user_secret')
	assert.ok(tool)
	return tool.execute(
		CALL,
		browserSecret,
		undefined,
		undefined,
		runner.createToolContext(CALL, undefined),
	)
}

test('an opted-in worker routes a browser secret through the broker whose flags ask_user_question registered', async context => {
	const runner = await loadedTools(context, async () => ({
		'human-dialog-worker': 'fixture-worker',
		'human-dialog-broker': pageBrokerScript(context),
	}))
	const toolResult = await askBrowserSecret(runner)
	const details = parseSecretResult(
		Reflect.get(Object(toolResult), 'details'),
	)
	assert.equal(details?.status, 'issued')
	assert.equal(details.origin, browserOrigin)
	assert.equal(details.broker?.result?.status, 'stored')
	assert.equal(JSON.stringify(toolResult).includes(syntheticSecret), false)
	assert.equal(JSON.stringify(details.broker).includes(details.handle), false)
	assert.deepEqual(secretHandoff().claim(details.handle, browserOrigin), {
		ok: true,
		value: syntheticSecret,
	})
	assert.deepEqual(secretHandoff().claim(details.handle, browserOrigin), {
		ok: false,
		reason: 'unknown',
	})
})

test('a session without the worker flag keeps the terminal-only secret prompt', async context => {
	const runner = await loadedTools(context, async () => ({}))
	await assert.rejects(askBrowserSecret(runner), {
		message: TERMINAL_PROMPT,
	})
})
