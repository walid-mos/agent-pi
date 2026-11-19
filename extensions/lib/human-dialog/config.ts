import { isAbsolute } from 'node:path'

import { BrokerDialog } from './broker.ts'
import { brokerTransport } from './transport.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { BrokerSource, UnboundRequest } from './schema.ts'

export type BrokerFactory = ((request: UnboundRequest) => BrokerDialog) & {
	readonly source: BrokerSource
}
type FlagReader = Pick<ExtensionAPI, 'getFlag'>
type FlagRequest = (owner: FlagReader) => void

const WORKER_FLAG = 'human-dialog-worker'
const BROKER_FLAG = 'human-dialog-broker'
const DEFAULT_BROKER = '/opt/agent-sandbox/session/human.mjs'
const FLAGS_CHANNEL = 'pi.human-dialog.flags.v1'
const NOT_OPTED_IN: FlagReader = { getFlag: () => undefined }

export function registerBrokerFlags(
	pi: Pick<ExtensionAPI, 'registerFlag' | 'getFlag' | 'events'>,
): void {
	pi.registerFlag(WORKER_FLAG, {
		type: 'string',
		description: 'Opt this worker into the Pots human-dialog broker.',
	})
	pi.registerFlag(BROKER_FLAG, {
		type: 'string',
		description: 'Absolute installed human.mjs path.',
		default: DEFAULT_BROKER,
	})
	pi.events.on(FLAGS_CHANNEL, request => {
		if (isFlagRequest(request))
			request({ getFlag: name => pi.getFlag(name) })
	})
}

/** Pi scopes getFlag to the extension that registered the flag, so other tools read the owner's flags over this session's event bus. */
export function brokerFlagReader(pi: Pick<ExtensionAPI, 'events'>): FlagReader {
	const owners: FlagReader[] = []
	pi.events.emit(FLAGS_CHANNEL, (owner: FlagReader) => {
		owners.push(owner)
	})
	if (owners.length > 1)
		throw new Error(
			'Several extensions answer for the Pots human-dialog flags. Load ask_user_question once.',
		)
	return owners[0] ?? NOT_OPTED_IN
}

function isFlagRequest(candidate: unknown): candidate is FlagRequest {
	return typeof candidate === 'function'
}

export function configuredBroker(
	pi: Pick<ExtensionAPI, 'getFlag'>,
	context: {
		sessionManager: Pick<
			ExtensionContext['sessionManager'],
			'getSessionFile'
		>
	},
	call: string,
): BrokerFactory | undefined {
	const worker = pi.getFlag(WORKER_FLAG)
	if (typeof worker === 'undefined') return undefined
	const script = pi.getFlag(BROKER_FLAG)
	const session = context.sessionManager.getSessionFile()
	if (
		typeof worker !== 'string' ||
		!/^[\w-]+$/.test(worker) ||
		typeof script !== 'string' ||
		!isAbsolute(script) ||
		!session ||
		!isAbsolute(session)
	)
		throw new Error(
			'Pots human dialogs require a worker name, absolute broker script and persisted absolute Pi session path.',
		)
	const source = { type: 'worker', worker, session, call } as const
	return Object.assign(
		(request: UnboundRequest) =>
			new BrokerDialog({ ...request, source }, brokerTransport(script)),
		{ source },
	)
}
