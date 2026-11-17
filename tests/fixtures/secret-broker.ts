import assert from 'node:assert/strict'
import { createConnection } from 'node:net'

import { BrokerDialog } from '../../extensions/lib/human-dialog/broker.ts'
import { dialogId } from '../../extensions/lib/human-dialog/receipt.ts'

import { source } from './human-broker.ts'

import type { BrokerFactory } from '../../extensions/lib/human-dialog/config.ts'
import type {
	BrokerReceipt,
	BrokerRequest,
} from '../../extensions/lib/human-dialog/schema.ts'

export const syntheticSecret = 'isolated-fixture-value'
export const browserOrigin = 'https://example.test'

function socketExchange(socket: string, packet: object): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const connection = createConnection(socket)
		const chunks: Buffer[] = []
		connection.on('connect', () =>
			connection.write(`${JSON.stringify(packet)}\n`),
		)
		connection.on('data', (chunk: Buffer) => chunks.push(chunk))
		connection.on('error', () =>
			reject(new Error('Private handoff failed.')),
		)
		connection.on('close', () => {
			if (!chunks.length)
				return reject(new Error('No private handoff ACK.'))
			const reply: unknown = JSON.parse(
				Buffer.concat(chunks).toString('utf8'),
			)
			resolve(reply)
		})
	})
}

export class SecretBrokerFixture {
	readonly opened = Promise.withResolvers<void>()
	readonly pendingGet = Promise.withResolvers<void>()
	readonly changed = Promise.withResolvers<void>()
	readonly writes: { origin: string; key: string }[] = []
	transform: (receipt: BrokerReceipt) => unknown = receipt => receipt
	isReceiptLost = false
	readonly handedOff = Promise.withResolvers<void>()
	readonly factory: BrokerFactory = Object.assign(
		(input: Parameters<BrokerFactory>[0]) => {
			assert.equal(input.kind, 'secret')
			if (input.kind !== 'secret')
				throw new Error('Not a secret request.')
			this.request = { ...input, source }
			return new BrokerDialog(
				this.request,
				async (operation, _id, candidate, signal) => {
					if (operation === 'open') this.opened.resolve()
					if (operation === 'get' && !this.result) {
						this.pendingGet.resolve()
						await this.wait(signal)
					}
					if (operation === 'secret') {
						assert.ok(candidate && typeof candidate === 'object')
						const key =
							this.request?.target.destination === 'browser'
								? 'SECRET'
								: 'API_KEY'
						assert.equal(
							Reflect.get(candidate, key),
							syntheticSecret,
						)
						await this.commit('terminal')
					}
					if (operation === 'cancel') this.cancel()
					return this.transform(this.receipt())
				},
			)
		},
		{ source },
	)
	request: Extract<BrokerRequest, { kind: 'secret' }> | undefined
	result: BrokerReceipt['result']
	private queue = Promise.resolve()

	receipt(): BrokerReceipt {
		assert.ok(this.request)
		const receipt: BrokerReceipt = {
			id: dialogId(this.request),
			kind: 'secret',
			policy: 'local',
		}
		if (this.result) receipt.result = this.result
		return receipt
	}

	async commit(origin: 'terminal' | 'page'): Promise<void> {
		const previous = this.queue
		const turn = Promise.withResolvers<void>()
		this.queue = turn.promise
		try {
			await previous
			await this.write(origin)
		} finally {
			turn.resolve()
		}
	}

	private async write(origin: 'terminal' | 'page'): Promise<void> {
		if (this.result) return
		assert.ok(this.request)
		const { target } = this.request
		const dialog = dialogId(this.request)
		this.writes.push({
			origin,
			key: target.destination === 'browser' ? 'SECRET' : target.name,
		})
		if (target.destination !== 'browser') {
			this.result = { status: 'stored', origin, at: 1, dialog }
			this.changed.resolve()
			return
		}
		const ack = await socketExchange(target.socket, {
			version: 1,
			dialog,
			source,
			origin: target.origin,
			capability: target.capability,
			value: syntheticSecret,
		})
		assert.ok(ack && typeof ack === 'object')
		const handoff: unknown = Reflect.get(ack, 'handoff')
		if (typeof handoff !== 'string') throw new Error('Invalid ACK.')
		this.handedOff.resolve()
		if (this.isReceiptLost) return
		this.result = {
			status: 'stored',
			origin,
			at: 1,
			dialog,
			target: { destination: 'browser', origin: target.origin },
			handoff,
		}
		this.changed.resolve()
	}

	cancel(): void {
		this.result ??= { status: 'cancelled', origin: 'terminal', at: 1 }
		this.changed.resolve()
	}

	private async wait(signal: AbortSignal | undefined): Promise<void> {
		signal?.throwIfAborted()
		let abort: (() => void) | undefined
		try {
			await Promise.race([
				this.changed.promise,
				new Promise<void>((_resolve, reject) => {
					abort = () => reject(new Error('Fixture wait aborted.'))
					signal?.addEventListener('abort', abort, { once: true })
				}),
			])
		} finally {
			if (abort) signal?.removeEventListener('abort', abort)
		}
	}
}
