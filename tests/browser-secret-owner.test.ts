import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { dirname } from 'node:path'
import { test } from 'node:test'

import { BrowserSecretOwner } from '../extensions/ui/ask-user-secret/browser-owner.ts'
import { secretHandoff } from '../extensions/ui/ask-user-secret/secret-store.ts'

import { source } from './fixtures/human-broker.ts'

import type { TestContext } from 'node:test'

const origin = 'https://example.test'
const binding = { dialog: 'fixture-dialog', source, origin }
const fixtureSecret = 'synthetic-test-password'

async function ownerFor(context: TestContext): Promise<BrowserSecretOwner> {
	const owner = await BrowserSecretOwner.open(binding)
	context.after(() => owner.dispose())
	return owner
}

function payload(owner: BrowserSecretOwner): object {
	return {
		version: 1,
		...binding,
		capability: owner.capability,
		value: fixtureSecret,
	}
}

function exchange(socket: string, packet: object): Promise<unknown> {
	return new Promise(resolve => {
		const connection = createConnection(socket)
		const chunks: Buffer[] = []
		connection.on('connect', () =>
			connection.write(`${JSON.stringify(packet)}\n`),
		)
		connection.on('data', (chunk: Buffer) => chunks.push(chunk))
		connection.on('error', () => resolve(undefined))
		connection.on('close', () => {
			if (!chunks.length) return resolve(undefined)
			resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
		})
	})
}

function acknowledgment(candidate: unknown): {
	dialog: string
	origin: string
	handoff: string
} {
	assert.ok(candidate && typeof candidate === 'object')
	const handoff: unknown = Reflect.get(candidate, 'handoff')
	assert.equal(typeof handoff, 'string')
	if (typeof handoff !== 'string')
		throw new Error('Missing handoff identifier')
	assert.equal(Reflect.get(candidate, 'value'), undefined)
	assert.equal(Reflect.get(candidate, 'handle'), undefined)
	assert.equal(Reflect.get(candidate, 'capability'), undefined)
	assert.deepEqual(Object.keys(candidate).toSorted(), [
		'dialog',
		'handoff',
		'origin',
		'source',
		'version',
	])
	assert.match(handoff, /^[a-f0-9]{32}$/)
	return { ...binding, handoff }
}

test('accepts a maximum-length secret whose JSON escapes exceed the old frame limit', async context => {
	const owner = await ownerFor(context)
	const escapedSecret = '\u0001'.repeat(4096)
	assert.equal(
		Buffer.byteLength(JSON.stringify({ value: escapedSecret })),
		24_588,
	)
	const ack = acknowledgment(
		await exchange(owner.socket, {
			...payload(owner),
			value: escapedSecret,
		}),
	)
	const issued = owner.confirm(ack)
	assert.deepEqual(secretHandoff().claim(issued.handle, origin), {
		ok: true,
		value: escapedSecret,
	})
})

test('private socket and directory have restrictive permissions and ACK reveals neither value nor handle', async context => {
	const owner = await ownerFor(context)
	assert.equal((await stat(owner.socket)).mode & 0o777, 0o600)
	assert.equal((await stat(dirname(owner.socket))).mode & 0o777, 0o700)
	const ack = acknowledgment(await exchange(owner.socket, payload(owner)))
	const issued = owner.confirm(ack)
	assert.match(issued.handle, /^sec:[A-Za-z0-9_-]{22}$/)
	assert.deepEqual(secretHandoff().claim(issued.handle, origin), {
		ok: true,
		value: fixtureSecret,
	})
	assert.deepEqual(secretHandoff().claim(issued.handle, origin), {
		ok: false,
		reason: 'unknown',
	})
})

for (const [field, mismatch] of [
	['origin', 'https://different.test'],
	['capability', 'wrong-capability'],
	['dialog', 'another-call'],
	['source', { ...source, call: 'another-call' }],
	['version', 2],
	['value', 'x'.repeat(20_000)],
] as const) {
	test(`rejects mismatched ${field} before parking any secret`, async context => {
		const owner = await ownerFor(context)
		assert.equal(
			await exchange(owner.socket, {
				...payload(owner),
				[field]: mismatch,
			}),
			undefined,
		)
		assert.throws(
			() => owner.confirm({ ...binding, handoff: 'invented' }),
			/no matching/,
		)
		const ack = acknowledgment(await exchange(owner.socket, payload(owner)))
		const issued = owner.confirm(ack)
		secretHandoff().claim(issued.handle, origin)
	})
}

test('duplicate handoffs cannot issue a second handle and another origin burns the one real handle', async context => {
	const owner = await ownerFor(context)
	const ack = acknowledgment(await exchange(owner.socket, payload(owner)))
	assert.equal(await exchange(owner.socket, payload(owner)), undefined)
	const issued = owner.confirm(ack)
	assert.throws(() => owner.confirm(ack), /no matching/)
	assert.deepEqual(
		secretHandoff().claim(issued.handle, 'https://wrong.test'),
		{ ok: false, reason: 'origin' },
	)
	assert.deepEqual(secretHandoff().claim(issued.handle, origin), {
		ok: false,
		reason: 'unknown',
	})
})

test('an owner expires its unconfirmed parked value without retrying issuance', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] })
	const owner = await ownerFor(context)
	const ack = acknowledgment(await exchange(owner.socket, payload(owner)))
	context.mock.timers.tick(9999)
	assert.equal(owner.signal.aborted, false)
	context.mock.timers.tick(1)
	assert.equal(owner.signal.aborted, true)
	assert.throws(() => owner.confirm(ack), /no matching/)
	assert.equal(await exchange(owner.socket, payload(owner)), undefined)
})

test('missing or mismatched broker confirmation fails closed and cancellation removes its socket', async context => {
	const owner = await ownerFor(context)
	const ack = acknowledgment(await exchange(owner.socket, payload(owner)))
	assert.throws(
		() => owner.confirm({ ...ack, handoff: 'unrelated-receipt' }),
		/no matching/,
	)
	await owner.dispose()
	assert.throws(() => owner.confirm(ack), /no matching/)
	await assert.rejects(stat(owner.socket), { code: 'ENOENT' })
})
