import { dialogId } from '#lib/human-dialog/receipt.ts'

import { describeTarget } from '../../../security/infisical-target.ts'

import { BrowserSecretOwner } from './browser-owner.ts'
import { secretSession } from './secret-session.ts'

import type { BrokerDialog } from '#lib/human-dialog/broker.ts'
import type { DialogCompletion } from '#lib/human-dialog/completion.ts'
import type { BrokerFactory } from '#lib/human-dialog/config.ts'
import type { BrokerReceipt, BrokerTarget } from '#lib/human-dialog/schema.ts'
import type { SecretRequest } from './request.ts'
import type { SecretResult } from './schema.ts'

export async function brokerSecret(
	createBroker: BrokerFactory,
	{ request, purpose }: { request: SecretRequest; purpose: string },
	show: (
		completion: DialogCompletion<string | undefined>,
	) => Promise<string | undefined>,
	signal: AbortSignal | undefined,
): Promise<SecretResult> {
	const owner =
		request.destination === 'browser'
			? await BrowserSecretOwner.open({
					dialog: dialogId(createBroker),
					source: createBroker.source,
					origin: request.origin,
				})
			: undefined
	let broker: BrokerDialog | undefined
	try {
		const target = brokerTarget(request, owner)
		broker = createBroker({ kind: 'secret', purpose, target })
		const watching = owner
			? AbortSignal.any([owner.signal, ...(signal ? [signal] : [])])
			: signal
		const receipt = await secretSession(
			broker,
			request.destination === 'browser' ? 'SECRET' : request.target.name,
			show,
			watching,
		)
		return secretReceipt(receipt, request, owner)
	} catch (error) {
		await broker?.perform('cancel').catch(() => undefined)
		throw error
	} finally {
		await owner?.dispose()
	}
}

function brokerTarget(
	request: SecretRequest,
	owner: BrowserSecretOwner | undefined,
): BrokerTarget {
	if (request.destination === 'browser') {
		if (!owner)
			throw new Error(
				'Browser handoff has no waiting owner. Open a new tool call.',
			)
		return {
			destination: 'browser',
			origin: request.origin,
			socket: owner.socket,
			capability: owner.capability,
		}
	}
	return {
		destination: 'infisical',
		projectId: request.target.workspaceId,
		environment: request.target.environment,
		path: request.target.path,
		name: request.target.name,
		replace: request.shouldReplace,
	}
}

function secretReceipt(
	receipt: BrokerReceipt,
	request: SecretRequest,
	owner: BrowserSecretOwner | undefined,
): SecretResult {
	const { result } = receipt
	if (result?.status === 'cancelled' || result?.status === 'expired')
		return { status: 'cancelled', broker: receipt }
	if (result?.status !== 'stored')
		throw new Error(
			'Pots returned an unexpected secret receipt. Check the destination before opening another request.',
		)
	if (request.destination === 'browser') {
		if (!owner || !result.handoff)
			throw new Error(
				'Browser completion has no matching live handoff. Open a new tool call.',
			)
		const issued = owner.confirm({
			dialog: receipt.id,
			origin: request.origin,
			handoff: result.handoff,
		})
		return {
			status: 'issued',
			...issued,
			origin: request.origin,
			broker: receipt,
		}
	}
	return {
		status: 'stored',
		target: describeTarget(request.target),
		operation: 'written',
		broker: receipt,
	}
}
