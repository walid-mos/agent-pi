import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { test } from 'node:test'

import { bindCompletion } from '../extensions/lib/human-dialog/completion.ts'
import { dialogId } from '../extensions/lib/human-dialog/receipt.ts'
import { brokerSecret } from '../extensions/ui/ask-user-secret/broker-secret.ts'
import { parseRequest } from '../extensions/ui/ask-user-secret/request.ts'
import { secretHandoff } from '../extensions/ui/ask-user-secret/secret-store.ts'

import { source } from './fixtures/human-broker.ts'
import {
	browserOrigin,
	SecretBrokerFixture,
	syntheticSecret,
} from './fixtures/secret-broker.ts'

import type {
	DialogCompletion,
	DialogOutcome,
} from '../extensions/lib/human-dialog/completion.ts'
import type { BrokerReceipt } from '../extensions/lib/human-dialog/schema.ts'
import type { SecretRequest } from '../extensions/ui/ask-user-secret/request.ts'
import type { SecretResult } from '../extensions/ui/ask-user-secret/schema.ts'

type Show = (
	completion: DialogCompletion<string | undefined>,
) => Promise<string | undefined>

const browser = { destination: 'browser', origin: browserOrigin } as const
const vault = parseRequest({
	kind: 'token',
	purpose: 'Fixture',
	destination: 'infisical',
	infisical: {
		projectId: 'test-project',
		environment: 'dev',
		name: 'API_KEY',
	},
})

function controller(): {
	show: Show
	submit(typed: string | undefined): void
} {
	const done = Promise.withResolvers<DialogOutcome<string | undefined>>()
	let submit: ((typed: string | undefined) => void) | undefined
	return {
		async show(completion) {
			submit = bindCompletion(completion, done.resolve)
			const outcome = await done.promise
			if (!outcome.ok) throw outcome.error
			return outcome.value
		},
		submit(typed) {
			assert.ok(submit)
			submit(typed)
		},
	}
}

function ask(
	fixture: SecretBrokerFixture,
	request: SecretRequest,
	show: Show,
	signal?: AbortSignal,
): Promise<SecretResult> {
	return brokerSecret(
		fixture.factory,
		{ request, purpose: 'Fixture' },
		show,
		signal,
	)
}

function storedWith(
	changes: object,
): (receipt: BrokerReceipt) => BrokerReceipt | object {
	return receipt => {
		if (receipt.result?.status !== 'stored') return receipt
		return { ...receipt, result: { ...receipt.result, ...changes } }
	}
}

async function pageSubmission(
	fixture: SecretBrokerFixture,
	request: SecretRequest,
): Promise<SecretResult> {
	const pending = ask(fixture, request, controller().show)
	await fixture.pendingGet.promise
	await fixture.commit('page')
	return pending
}

for (const destination of [browser, vault]) {
	test(`${destination.destination} page receipt closes the waiting controller without exposing the entered value`, async () => {
		const fixture = new SecretBrokerFixture()
		const settled = await pageSubmission(fixture, destination)
		assert.equal(JSON.stringify(settled).includes(syntheticSecret), false)
		assert.deepEqual(fixture.writes, [
			{
				origin: 'page',
				key:
					destination.destination === 'browser'
						? 'SECRET'
						: 'API_KEY',
			},
		])
		if (settled.status !== 'issued')
			return assert.equal(settled.status, 'stored')
		assert.ok(fixture.request?.target.destination === 'browser')
		const visible = JSON.stringify(settled)
		assert.equal(visible.includes(fixture.request.target.capability), false)
		assert.equal(visible.includes(fixture.request.target.socket), false)
		assert.deepEqual(secretHandoff().claim(settled.handle, browserOrigin), {
			ok: true,
			value: syntheticSecret,
		})
		return assert.rejects(stat(fixture.request.target.socket), {
			code: 'ENOENT',
		})
	})

	test(`${destination.destination} terminal Escape settles cancellation without writing`, async () => {
		const fixture = new SecretBrokerFixture()
		const ui = controller()
		const pending = ask(fixture, destination, ui.show)
		await fixture.pendingGet.promise
		ui.submit(undefined)
		assert.equal((await pending).status, 'cancelled')
		assert.deepEqual(fixture.writes, [])
	})
}

for (const first of ['page', 'terminal'] as const) {
	test(`browser ${first} submission wins a terminal/page race with one real handle`, async () => {
		const fixture = new SecretBrokerFixture()
		const ui = controller()
		const pending = ask(fixture, browser, ui.show)
		await fixture.pendingGet.promise
		if (first === 'terminal') ui.submit(syntheticSecret)
		await fixture.commit('page')
		if (first === 'page') ui.submit(syntheticSecret)
		const issued = await pending
		assert.equal(issued.broker?.result?.origin, first)
		assert.equal(fixture.writes.length, 1)
		if (issued.status !== 'issued')
			throw new Error('Missing browser handle')
		assert.deepEqual(secretHandoff().claim(issued.handle, browserOrigin), {
			ok: true,
			value: syntheticSecret,
		})
		assert.deepEqual(secretHandoff().claim(issued.handle, browserOrigin), {
			ok: false,
			reason: 'unknown',
		})
	})
}

test('a stored browser receipt without this process parking a value never fabricates a handle on restart', async () => {
	const fixture = new SecretBrokerFixture()
	fixture.result = {
		status: 'stored',
		origin: 'page',
		at: 1,
		dialog: dialogId({ source }),
		target: { destination: 'browser', origin: browserOrigin },
		handoff: 'a'.repeat(32),
	}
	await assert.rejects(
		ask(fixture, browser, async () => {
			throw new Error('Must not reopen UI')
		}),
		/no matching/,
	)
})

test('a parked value without a committed broker receipt fails on cancellation and removes the socket', async () => {
	const fixture = new SecretBrokerFixture()
	fixture.isReceiptLost = true
	const cancelled = new AbortController()
	const pending = ask(fixture, browser, controller().show, cancelled.signal)
	await fixture.pendingGet.promise
	await fixture.commit('page')
	await fixture.handedOff.promise
	cancelled.abort()
	await assert.rejects(pending, /aborted/)
	assert.equal(fixture.result?.status, 'cancelled')
	assert.ok(fixture.request?.target.destination === 'browser')
	await assert.rejects(stat(fixture.request.target.socket), {
		code: 'ENOENT',
	})
})

for (const [name, altered] of [
	['another dialog', { dialog: 'b'.repeat(32) }],
	['another registered request', { request: 'another-door' }],
] as const) {
	test(`a secret receipt for ${name} cannot complete the waiting call`, async () => {
		const fixture = new SecretBrokerFixture()
		const alter = storedWith({ request: 'fixture-door', ...altered })
		fixture.transform = receipt => ({
			...alter(receipt),
			delivery: { id: 'fixture-door' },
		})
		await assert.rejects(
			pageSubmission(fixture, vault),
			/this dialog and its registered request/,
		)
	})
}

test('a stored secret receipt that omits the registered request cannot complete the waiting call', async () => {
	const fixture = new SecretBrokerFixture()
	fixture.transform = receipt => ({
		...receipt,
		delivery: { id: 'fixture-door' },
	})
	await assert.rejects(
		pageSubmission(fixture, vault),
		/this dialog and its registered request/,
	)
})

test('a secret receipt bound to its registered request completes the waiting call', async () => {
	const fixture = new SecretBrokerFixture()
	const bind = storedWith({ request: 'fixture-door' })
	fixture.transform = receipt => ({
		...bind(receipt),
		delivery: { id: 'fixture-door' },
	})
	assert.equal((await pageSubmission(fixture, vault)).status, 'stored')
})

test('a browser receipt cannot claim a different target origin', async () => {
	const fixture = new SecretBrokerFixture()
	fixture.transform = storedWith({
		target: { destination: 'browser', origin: 'https://other.test' },
	})
	await assert.rejects(
		pageSubmission(fixture, browser),
		/declared destination and origin/,
	)
})
