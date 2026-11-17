import { dialogId } from '#lib/human-dialog/receipt.ts'

import { describeTarget } from '../../../security/infisical-target.ts'

import { BrowserSecretOwner } from './browser-owner.ts'
import { secretSession } from './secret-session.ts'

import type { DialogCompletion } from '#lib/human-dialog/completion.ts'
import type { BrokerFactory } from '#lib/human-dialog/config.ts'
import type {
	BrokerReceipt,
	BrokerStored,
	BrokerTarget,
} from '#lib/human-dialog/schema.ts'
import type { SecretRequest } from './request.ts'
import type { SecretResult } from './schema.ts'

type ShowSecret = (
	completion: DialogCompletion<string | undefined>,
) => Promise<string | undefined>
type Settlement = {
	target: BrokerTarget
	key: string
	signal: AbortSignal | undefined
	stored: (receipt: BrokerReceipt, result: BrokerStored) => SecretResult
}

export async function brokerSecret(
	createBroker: BrokerFactory,
	{ request, purpose }: { request: SecretRequest; purpose: string },
	show: ShowSecret,
	signal: AbortSignal | undefined,
): Promise<SecretResult> {
	if (request.destination === 'infisical')
		return settle(
			createBroker,
			purpose,
			show,
			vaultSettlement(request, signal),
		)
	const owner = await BrowserSecretOwner.open({
		dialog: dialogId(createBroker),
		source: createBroker.source,
		origin: request.origin,
	})
	try {
		return await settle(
			createBroker,
			purpose,
			show,
			browserSettlement(request.origin, owner, signal),
		)
	} finally {
		await owner.dispose()
	}
}

function vaultSettlement(
	request: Extract<SecretRequest, { destination: 'infisical' }>,
	signal: AbortSignal | undefined,
): Settlement {
	return {
		target: {
			destination: 'infisical',
			projectId: request.target.workspaceId,
			environment: request.target.environment,
			path: request.target.path,
			name: request.target.name,
			replace: request.shouldReplace,
		},
		key: request.target.name,
		signal,
		stored: receipt => ({
			status: 'stored',
			target: describeTarget(request.target),
			operation: 'written',
			broker: receipt,
		}),
	}
}

function browserSettlement(
	origin: string,
	owner: BrowserSecretOwner,
	signal: AbortSignal | undefined,
): Settlement {
	return {
		target: {
			destination: 'browser',
			origin,
			socket: owner.socket,
			capability: owner.capability,
		},
		key: 'SECRET',
		signal: AbortSignal.any([owner.signal, ...(signal ? [signal] : [])]),
		stored: (receipt, outcome) => {
			const issued = owner.confirm({
				dialog: receipt.id,
				origin,
				handoff: outcome.handoff,
			})
			return { status: 'issued', ...issued, origin, broker: receipt }
		},
	}
}

async function settle(
	createBroker: BrokerFactory,
	purpose: string,
	show: ShowSecret,
	{ target, key, signal, stored }: Settlement,
): Promise<SecretResult> {
	const broker = createBroker({ kind: 'secret', purpose, target })
	try {
		const receipt = await secretSession(broker, key, show, signal)
		const { result: outcome } = receipt
		if (outcome?.status === 'cancelled' || outcome?.status === 'expired')
			return { status: 'cancelled', broker: receipt }
		if (outcome?.status !== 'stored')
			throw new Error(
				'Pots returned an unexpected secret receipt. Check the destination before opening another request.',
			)
		return stored(receipt, outcome)
	} catch (error) {
		await broker.perform('cancel').catch(() => undefined)
		throw error
	}
}
