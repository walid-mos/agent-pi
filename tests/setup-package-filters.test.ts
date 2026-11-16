import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { applySettings, pinnedSettings } from '../bin/lib/setup/settings.ts'

import type { TestContext } from 'node:test'

const BASE_PACKAGE = './packages/base'
const ORG_PACKAGE = '/organization/agent-overlay'
const FILTERED_BASE = { source: BASE_PACKAGE, extensions: ['!./noisy.ts'] }
const FILTERED_ORG = { source: ORG_PACKAGE, skills: ['./skills/one'] }

function putJson(directory: string, file: string, contents: unknown): void {
	writeFileSync(join(directory, file), JSON.stringify(contents))
}

function livePackages(directory: string): unknown {
	return JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8'))
		.packages
}

function createAgent(context: TestContext): string {
	const directory = mkdtempSync(join(tmpdir(), 'pi-setup-filters-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	putJson(directory, 'settings.pinned.json', { packages: [BASE_PACKAGE] })
	putJson(directory, 'settings.defaults.json', {})
	putJson(directory, 'settings.json', {
		packages: [FILTERED_BASE, FILTERED_ORG],
	})
	return directory
}

function setup(directory: string, overlays: string[]): void {
	applySettings(directory, pinnedSettings(directory, overlays))
}

test('keeps a user filtered entry for a managed package source', context => {
	const directory = createAgent(context)
	setup(directory, [ORG_PACKAGE])
	assert.deepEqual(livePackages(directory), [FILTERED_BASE, FILTERED_ORG])
})

test('removes a filtered entry once its overlay root is no longer registered', context => {
	const directory = createAgent(context)
	setup(directory, [ORG_PACKAGE])
	setup(directory, [])
	assert.deepEqual(livePackages(directory), [FILTERED_BASE])
})
