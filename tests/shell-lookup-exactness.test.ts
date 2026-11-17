import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shellLookupPlan } from '../extensions/tools/guard/shell-guard.ts'

const ACTIVE_TOOLS = ['read', 'grep', 'find', 'ls']
const CWD = '/repo'

function planKind(command: string): string | undefined {
	return shellLookupPlan({ command }, ACTIVE_TOOLS, CWD)?.kind
}

function redirect(command: string): unknown {
	const plan = shellLookupPlan({ command }, ACTIVE_TOOLS, CWD)
	if (plan?.kind !== 'redirect') return plan
	return { tool: plan.tool, args: plan.args }
}

test('find -iname with an uppercase pattern is refused: the find tool would match it case-sensitively', () => {
	assert.equal(planKind("find . -iname '*.MD'"), 'refuse')
})

test('find with a -type filter is refused: the find tool returns files and directories alike', () => {
	assert.deepEqual(
		['find . -name lib -type d', "find src -name '*.ts' -type f"].map(
			planKind,
		),
		['refuse', 'refuse'],
	)
})

test('ls -l is refused: the ls tool returns names without metadata', () => {
	assert.deepEqual(['ls -l', 'ls -la src', 'ls -1l'].map(planKind), [
		'refuse',
		'refuse',
		'refuse',
	])
})

test('find -iname with a lowercase pattern still runs through the find tool', () => {
	assert.deepEqual(redirect("find . -iname '*.md'"), {
		tool: 'find',
		args: { pattern: '**/*.md', path: '/repo' },
	})
})

test('find -name with an uppercase pattern still runs through the find tool', () => {
	assert.deepEqual(redirect("find src -name '*.MD' | head -n 5"), {
		tool: 'find',
		args: { pattern: '**/*.MD', path: '/repo/src', limit: 5 },
	})
})

test('ls -a and ls -1 still run through the ls tool', () => {
	assert.deepEqual(
		[redirect('ls -a src'), redirect('ls -1')],
		[
			{ tool: 'ls', args: { path: '/repo/src' } },
			{ tool: 'ls', args: { path: '/repo' } },
		],
	)
})
