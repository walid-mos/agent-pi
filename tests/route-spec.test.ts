import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadRoutingSpec, SPEC_FILE } from '../extensions/model/route/spec.ts'

import type { TestContext } from 'node:test'

const SPEC_WITHOUT_RULES = {
	group: 'router',
	classifier: 'typesafe/jev-latest',
	intentSure: 0.15,
	members: ['group/fast', 'group/instant', 'group/deep'],
	scopes: { harness: ['~/.pi/agent'] },
	intents: { trivial: 'chit-chat or a test ping' },
	pins: {},
}
const LONG_CONVERSATION = {
	intent: 'trivial',
	tokens: 60000,
	use: ['group/fast'],
}
const VERY_LONG_CONVERSATION = {
	intent: 'trivial',
	tokens: 200000,
	use: ['group/deep'],
}
const ANY_LENGTH = { intent: 'trivial', use: ['group/instant'] }
const ANY_LENGTH_IN_HARNESS = {
	scope: 'harness',
	intent: 'trivial',
	use: ['group/deep'],
}

function loadedRules(context: TestContext, rules: unknown[]): unknown[] {
	const agentDir = mkdtempSync(join(tmpdir(), 'pi-route-spec-'))
	context.after(() => rmSync(agentDir, { recursive: true, force: true }))
	writeFileSync(
		join(agentDir, SPEC_FILE),
		JSON.stringify({ ...SPEC_WITHOUT_RULES, rules }),
	)
	return loadRoutingSpec(agentDir).rules
}

test('keeps rules of one intent ordered from the highest token floor to none', context => {
	const rules = [VERY_LONG_CONVERSATION, LONG_CONVERSATION, ANY_LENGTH]
	assert.deepEqual(loadedRules(context, rules), rules)
})

test('refuses a long-conversation rule behind the rule for any length', context => {
	assert.throws(
		() => loadedRules(context, [ANY_LENGTH, LONG_CONVERSATION]),
		/rules\[1\] never holds: rules\[0\] comes first/,
	)
})

test('refuses a rule behind one of the same intent with a lower token floor', context => {
	assert.throws(
		() =>
			loadedRules(context, [
				LONG_CONVERSATION,
				VERY_LONG_CONVERSATION,
				ANY_LENGTH,
			]),
		/rules\[1\] never holds: rules\[0\] comes first/,
	)
})

test('keeps a scoped rule ahead of the same intent without scope', context => {
	const rules = [ANY_LENGTH_IN_HARNESS, ANY_LENGTH]
	assert.deepEqual(loadedRules(context, rules), rules)
})

test('refuses a token floor that is not a positive integer', context => {
	for (const tokens of [0, -60000, 1.5, '60k']) {
		assert.throws(
			() => loadedRules(context, [{ ...LONG_CONVERSATION, tokens }]),
			/\/rules\/0\/tokens/,
			`tokens ${tokens}`,
		)
	}
})
