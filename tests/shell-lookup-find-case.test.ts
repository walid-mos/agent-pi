import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shellLookupPlan } from '../extensions/tools/guard/shell-guard.ts'

void test('find -name refuses lowercase patterns that the find tool would match without case sensitivity', () => {
	for (const command of [
		"find . -name '*.md'",
		'find . -name lib',
		"cd docs && find . -name '*.md' | head -n 5",
	]) {
		assert.deepEqual(shellLookupPlan(command, ['find'], '/repo'), {
			kind: 'refuse',
			reason: 'Use the active find tool for this file lookup. Use bash for commands that transform or store results.',
		})
	}
})

void test('find refuses glob forms whose shell matching semantics are not preserved', () => {
	for (const predicate of ['-name', '-iname']) {
		for (const pattern of ['{ABC,abc}', '?', '[!A]*', '**.MD', 'é']) {
			const command = `find . ${predicate} '${pattern}'`
			assert.equal(
				shellLookupPlan(command, ['find'], '/repo')?.kind,
				'refuse',
				command,
			)
		}
	}
})

void test('find -iname refuses mixed-case patterns and keeps lowercase star patterns', () => {
	assert.equal(
		shellLookupPlan("find . -iname '*.Md'", ['find'], '/repo')?.kind,
		'refuse',
	)
	const plan = shellLookupPlan("find . -iname 'read*.md'", ['find'], '/repo')
	assert.ok(plan?.kind === 'redirect')
	assert.deepEqual(plan.args, { pattern: '**/read*.md', path: '/repo' })
})

void test('find type filters refuse even when their name pattern has exact case semantics', () => {
	for (const type of ['f', 'd', 'l', 'b', 'c', 'p', 's']) {
		for (const command of [
			`find . -name '*.MD' -type ${type}`,
			`find . -type ${type} -name '*.MD'`,
		]) {
			assert.equal(
				shellLookupPlan(command, ['find'], '/repo')?.kind,
				'refuse',
				command,
			)
		}
	}
})

void test('ls combined short flags redirect only when they do not request metadata', () => {
	for (const command of ['ls -a1', 'ls -a -1']) {
		assert.equal(
			shellLookupPlan(command, ['ls'], '/repo')?.kind,
			'redirect',
			command,
		)
	}
	for (const command of ['ls -al1', 'ls -a -l', 'ls -1 -l']) {
		assert.equal(
			shellLookupPlan(command, ['ls'], '/repo')?.kind,
			'refuse',
			command,
		)
	}
})

void test('find patterns without case-bearing letters keep their redirects', () => {
	for (const predicate of ['-name', '-iname']) {
		for (const pattern of ['123', '*.123', '*']) {
			const command = `find . ${predicate} '${pattern}'`
			const plan = shellLookupPlan(command, ['find'], '/repo')
			assert.ok(plan?.kind === 'redirect', command)
			assert.deepEqual(plan.args, {
				pattern: `**/${pattern}`,
				path: '/repo',
			})
		}
	}
})
