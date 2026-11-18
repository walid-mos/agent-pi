import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { installFakeGh } from './fixtures/fake-gh.mts'

import type { SpawnSyncReturns } from 'node:child_process'
import type { TestContext } from 'node:test'

const draftPr = resolve('skills/worktree/scripts/draft-pr')
const branch = 'fix/fixture-task'
const title = 'fix(fixture): open the task draft'
const createdPullRequest = 'https://github.invalid/fixture/repository/pull/1'
const description = [
	'- Purpose: open the draft with a public summary.',
	'- Behavior: keeps `code`, $HOME, \'quotes\' and "double quotes" as typed.',
	'',
	'Checks planned: `pnpm test`, not yet run.',
].join('\n')

type Fixture = {
	checkout: string
	calls: string
	environment: NodeJS.ProcessEnv
}

function git(fixture: Fixture, cwd: string, ...args: string[]): string {
	const run = spawnSync('git', args, {
		cwd,
		env: fixture.environment,
		encoding: 'utf8',
	})
	assert.equal(run.status, 0, run.stderr)
	return run.stdout.trim()
}

function createFixture(t: TestContext, openPullRequest = ''): Fixture {
	const root = mkdtempSync(join(tmpdir(), 'draft-pr-'))
	t.after(() => rmSync(root, { recursive: true, force: true }))
	const bin = join(root, 'bin')
	mkdirSync(bin)
	const fakeGhEnvironment = installFakeGh(bin)
	const fixture = {
		checkout: join(root, 'checkout'),
		calls: join(root, 'gh-calls.jsonl'),
		environment: {
			PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
			HOME: root,
			GIT_CONFIG_GLOBAL: '/dev/null',
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_AUTHOR_NAME: 'Fixture',
			GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
			GIT_COMMITTER_NAME: 'Fixture',
			GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
			...fakeGhEnvironment,
			FAKE_GH_CALLS: join(root, 'gh-calls.jsonl'),
			FAKE_GH_OPEN_PULL_REQUEST: openPullRequest,
			FAKE_GH_CREATED_PULL_REQUEST: createdPullRequest,
		},
	}
	writeFileSync(fixture.calls, '')
	const remote = join(root, 'remote.git')
	git(fixture, root, 'init', '--quiet', '--bare', '-b', 'main', remote)
	git(fixture, root, 'init', '--quiet', '-b', 'main', fixture.checkout)
	git(
		fixture,
		fixture.checkout,
		'commit',
		'-q',
		'--allow-empty',
		'-m',
		'seed',
	)
	git(fixture, fixture.checkout, 'remote', 'add', 'origin', remote)
	git(
		fixture,
		fixture.checkout,
		'push',
		'-q',
		'origin',
		'main',
		'main:develop',
	)
	git(fixture, fixture.checkout, 'switch', '-q', '-c', branch)
	return fixture
}

function runDraftPr(
	fixture: Fixture,
	...args: string[]
): SpawnSyncReturns<string> {
	return spawnSync(draftPr, [fixture.checkout, title, ...args], {
		env: fixture.environment,
		encoding: 'utf8',
	})
}

const GhCall = Type.Array(Type.String())

function ghCalls(fixture: Fixture): string[][] {
	return readFileSync(fixture.calls, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map(line => Value.Parse(GhCall, JSON.parse(line)))
}

function createdWith(fixture: Fixture, flag: string): string | undefined {
	const create = ghCalls(fixture).find(
		([group, action]) => group === 'pr' && action === 'create',
	)
	assert.ok(create, 'gh pr create was not called')
	return create[create.indexOf(flag) + 1]
}

function remoteBranchHead(fixture: Fixture): string {
	return git(
		fixture,
		fixture.checkout,
		'ls-remote',
		'origin',
		`refs/heads/${branch}`,
	)
}

const refusals: Record<string, string[]> = {
	'a call without --description': [],
	'a former base branch in place of the description': ['main'],
	'--description without a value': ['--description'],
	'a blank description': ['--description', ' \n\t '],
	'a blank description followed by a base': ['--description', '', 'main'],
}

for (const [refusal, args] of Object.entries(refusals)) {
	test(`refuses ${refusal} before any Git or GitHub side effect`, t => {
		const fixture = createFixture(t)
		const head = git(fixture, fixture.checkout, 'rev-parse', 'HEAD')
		const run = runDraftPr(fixture, ...args)
		assert.notEqual(run.status, 0)
		assert.match(run.stderr, /--description/u)
		assert.deepEqual(ghCalls(fixture), [])
		assert.equal(git(fixture, fixture.checkout, 'rev-parse', 'HEAD'), head)
		assert.equal(remoteBranchHead(fixture), '')
	})
}

test('opens the draft on the default branch with the multiline description as its body', t => {
	const fixture = createFixture(t)
	const run = runDraftPr(fixture, '--description', description)
	assert.equal(run.status, 0, run.stderr)
	assert.equal(run.stdout.trim(), createdPullRequest)
	assert.equal(createdWith(fixture, '--body'), description)
	assert.equal(createdWith(fixture, '--base'), 'main')
	assert.equal(createdWith(fixture, '--title'), title)
	const head = git(fixture, fixture.checkout, 'rev-parse', 'HEAD')
	assert.match(remoteBranchHead(fixture), new RegExp(`^${head}\\s`, 'u'))
})

test('opens the draft on an explicit base branch after the description', t => {
	const fixture = createFixture(t)
	const run = runDraftPr(fixture, '--description', description, 'develop')
	assert.equal(run.status, 0, run.stderr)
	assert.equal(createdWith(fixture, '--base'), 'develop')
	assert.equal(createdWith(fixture, '--body'), description)
})

test('returns an open pull request without pushing, creating or editing one', t => {
	const openPullRequest = 'https://github.invalid/fixture/repository/pull/9'
	const fixture = createFixture(t, openPullRequest)
	const head = git(fixture, fixture.checkout, 'rev-parse', 'HEAD')
	const run = runDraftPr(fixture, '--description', description)
	assert.equal(run.status, 0, run.stderr)
	assert.equal(run.stdout.trim(), openPullRequest)
	assert.deepEqual(
		ghCalls(fixture).map(([group, action]) => `${group} ${action}`),
		['pr list'],
	)
	assert.equal(git(fixture, fixture.checkout, 'rev-parse', 'HEAD'), head)
	assert.equal(remoteBranchHead(fixture), '')
})
