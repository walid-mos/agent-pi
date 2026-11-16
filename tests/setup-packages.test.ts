import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { applySettings, pinnedSettings } from '../bin/lib/setup/settings.ts'

import type { TestContext } from 'node:test'

const BASE_PACKAGE = './packages/base'
const ORG_PACKAGE = '/organization/agent-overlay'
const USER_PACKAGE = 'npm:personal-tools@1.0.0'
const USER_RESOURCE = { source: '/personal/resources', skills: ['./skills'] }

function putJson(directory: string, file: string, settings: unknown): void {
	writeFileSync(join(directory, file), JSON.stringify(settings))
}

function settingsText(directory: string): string {
	return readFileSync(join(directory, 'settings.json'), 'utf8')
}

function createAgent(context: TestContext): string {
	const directory = mkdtempSync(join(tmpdir(), 'pi-setup-packages-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	putJson(directory, 'settings.pinned.json', { packages: [BASE_PACKAGE] })
	putJson(directory, 'settings.defaults.json', {
		defaultModel: 'group/router',
	})
	putJson(directory, 'settings.json', {
		packages: [USER_PACKAGE, USER_RESOURCE],
		defaultModel: 'group/fast',
	})
	return directory
}

function setup(directory: string, overlays: string[]): void {
	applySettings(directory, pinnedSettings(directory, overlays))
}

test('preserves unrelated string and resource package registrations while overlays toggle', context => {
	const directory = createAgent(context)
	setup(directory, [ORG_PACKAGE])
	assert.deepEqual(JSON.parse(settingsText(directory)), {
		packages: [USER_PACKAGE, USER_RESOURCE, BASE_PACKAGE, ORG_PACKAGE],
		defaultModel: 'group/fast',
	})
	setup(directory, [])
	assert.deepEqual(JSON.parse(settingsText(directory)), {
		packages: [USER_PACKAGE, USER_RESOURCE, BASE_PACKAGE],
		defaultModel: 'group/fast',
	})
	setup(directory, [ORG_PACKAGE])
	const enabled = settingsText(directory)
	setup(directory, [ORG_PACKAGE])
	assert.equal(settingsText(directory), enabled)
})

test('removes retired managed base packages without removing user registrations', context => {
	const directory = createAgent(context)
	setup(directory, [ORG_PACKAGE])
	putJson(directory, 'settings.pinned.json', { packages: [] })
	setup(directory, [])
	assert.deepEqual(JSON.parse(settingsText(directory)), {
		packages: [USER_PACKAGE, USER_RESOURCE],
		defaultModel: 'group/fast',
	})
})

test('rejects malformed ownership state before changing settings', context => {
	const directory = createAgent(context)
	const before = settingsText(directory)
	putJson(directory, 'setup-packages.json', { packages: 'broken' })
	assert.throws(
		() => setup(directory, []),
		/setup-packages\.json.*packages.*array/,
	)
	assert.equal(settingsText(directory), before)
})
