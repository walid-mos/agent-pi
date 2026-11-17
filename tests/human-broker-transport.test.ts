import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { BrokerDialog } from '../extensions/lib/human-dialog/broker.ts'
import { brokerTransport } from '../extensions/lib/human-dialog/transport.ts'

import { request } from './fixtures/human-broker.ts'

const script = fileURLToPath(
	new URL('./fixtures/human-cli.mjs', import.meta.url),
)
const syntheticSecret = 'synthetic-no-live-credential'

test('secret subprocess receives values only through stdin and treats shell syntax as literal metadata', async () => {
	const transport = brokerTransport(script)
	assert.deepEqual(
		await transport('secret', '$(false); literal-id', {
			secret: syntheticSecret,
		}),
		{
			operation: 'secret',
			id: '$(false); literal-id',
			argumentCount: 4,
			receivedOnStdin: true,
		},
	)
})

test('writer failures cannot echo secret values from stdout or stderr into tool errors', async () => {
	const transport = brokerTransport(script)
	await assert.rejects(
		transport('secret', 'fixture', {
			mode: 'fail',
			secret: syntheticSecret,
		}),
		error => {
			assert.ok(error instanceof Error)
			assert.equal(error.message.includes(syntheticSecret), false)
			assert.match(error.message, /broker secret failed/)
			return true
		},
	)
})

test('a successful process reflecting a value cannot become a trusted metadata receipt', async () => {
	const transport = brokerTransport(script)
	const dialog = new BrokerDialog(request, (operation, id, _input, signal) =>
		transport(
			operation,
			id,
			{ mode: 'reflect', secret: syntheticSecret },
			signal,
		),
	)
	await assert.rejects(dialog.open(), error => {
		assert.ok(error instanceof Error)
		assert.equal(error.message.includes(syntheticSecret), false)
		assert.match(error.message, /invalid metadata receipt/)
		return true
	})
})
