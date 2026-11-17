import { setTimeout } from 'node:timers/promises'

import { checkedReceipt, dialogId } from './receipt.ts'

import type { BrokerReceipt, BrokerRequest } from './schema.ts'
import type { BrokerOperation, BrokerTransport } from './transport.ts'

const POLL_INTERVAL_MS = 700

export class BrokerDialog {
	readonly id: string

	constructor(
		readonly request: BrokerRequest,
		private readonly transport: BrokerTransport,
	) {
		this.id = dialogId(request)
	}

	async open(signal?: AbortSignal): Promise<BrokerReceipt> {
		return this.perform('open', this.request, signal)
	}

	async perform(
		operation: BrokerOperation,
		input?: unknown,
		signal?: AbortSignal,
	): Promise<BrokerReceipt> {
		let id: string | undefined
		if (operation !== 'open') id = this.id
		const receipt = await this.transport(operation, id, input, signal)
		return checkedReceipt(receipt, this.request)
	}

	async wait(signal: AbortSignal): Promise<BrokerReceipt> {
		signal.throwIfAborted()
		const receipt = await this.perform('get', undefined, signal)
		if (receipt.result) return receipt
		await setTimeout(POLL_INTERVAL_MS, undefined, { signal })
		return this.wait(signal)
	}
}
