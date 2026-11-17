import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
	magpieProvidersPath,
	resolveCodexGroup,
} from '../extensions/lib/magpie-codex.ts'

import type { TestContext } from 'node:test'

function providersFile(context: TestContext): string {
	const directory = mkdtempSync(join(tmpdir(), 'pi-codex-groups-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	return join(directory, 'providers.json')
}

function putGroup(path: string, members: string[]): void {
	writeFileSync(path, JSON.stringify({ groups: [{ id: 'expert', members }] }))
}

test('maps the first Codex member to the direct provider and preserves its effort', context => {
	const path = providersFile(context)
	putGroup(path, [
		'claude/claude-opus-5-5:high',
		'group/deep',
		'codex/gpt-6.1-sol:high',
		'codex/gpt-6-luna:low',
	])
	assert.deepEqual(resolveCodexGroup('expert', path), {
		provider: 'openai-codex',
		id: 'gpt-6.1-sol',
		thinkingLevel: 'high',
	})
})

test('rereads group membership after a synthetic model and effort update', context => {
	const path = providersFile(context)
	putGroup(path, ['codex/gpt-6.1-sol:high'])
	assert.equal(resolveCodexGroup('expert', path).id, 'gpt-6.1-sol')
	putGroup(path, ['codex/gpt-6.2-sol:medium'])
	assert.deepEqual(resolveCodexGroup('expert', path), {
		provider: 'openai-codex',
		id: 'gpt-6.2-sol',
		thinkingLevel: 'medium',
	})
})

test('uses the Magpie config under the supplied home on Mac and pots', () => {
	assert.equal(
		magpieProvidersPath('/Users/walid'),
		'/Users/walid/.config/magpie/providers.json',
	)
	assert.equal(
		magpieProvidersPath('/config'),
		'/config/.config/magpie/providers.json',
	)
})

test('names a missing file without falling back to another source', context => {
	const path = providersFile(context)
	assert.throws(() => resolveCodexGroup('expert', path), {
		message: `Cannot resolve Codex group expert: read valid Magpie groups from ${path}. Restore or seed the Magpie configuration.`,
	})
})

test('names invalid configuration without including provider secrets', context => {
	const path = providersFile(context)
	writeFileSync(path, '{"key":"synthetic-private-value", broken')
	assert.throws(() => resolveCodexGroup('expert', path), {
		message: `Cannot resolve Codex group expert: read valid Magpie groups from ${path}. Restore or seed the Magpie configuration.`,
	})
	writeFileSync(
		path,
		JSON.stringify({ groups: [{ id: 'expert', members: 42 }] }),
	)
	assert.throws(
		() => resolveCodexGroup('expert', path),
		/read valid Magpie groups/,
	)
})

test('distinguishes a missing group from one without a Codex member', context => {
	const path = providersFile(context)
	putGroup(path, ['claude/claude-opus-5-5:high', 'group/deep'])
	assert.throws(() => resolveCodexGroup('deep', path), /missing group deep/)
	assert.throws(
		() => resolveCodexGroup('expert', path),
		/group expert has no Codex member/,
	)
})

for (const member of [
	'codex/gpt-6.2-sol',
	'codex/gpt-6.2-sol:ultra',
	'codex/gpt-6.2-sol:high:fast',
	'codex/:high',
	'codex/claude-opus-5-5:high',
]) {
	test(`rejects unusable first Codex member ${member} without trying the next one`, context => {
		const path = providersFile(context)
		putGroup(path, [member, 'codex/gpt-6.1-sol:high'])
		assert.throws(
			() => resolveCodexGroup('expert', path),
			/group expert needs a non-Anthropic Codex model with a Pi-supported effort/,
		)
	})
}
