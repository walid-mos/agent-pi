import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'

import { BrokerDialog } from '../../extensions/lib/human-dialog/broker.ts'
import { dialogId } from '../../extensions/lib/human-dialog/receipt.ts'
import { brokerQuestionnaire } from '../../extensions/ui/ask-user-question/broker-questionnaire.ts'
import { secretSession } from '../../extensions/ui/ask-user-secret/secret-session.ts'

import { questions, request, source } from './human-broker.ts'

const [, , kind] = process.argv
const binding =
	kind === 'question'
		? request
		: {
				kind: 'secret',
				source,
				purpose: 'Fixture',
				target: {
					destination: 'infisical',
					projectId: 'fixture',
					environment: 'dev',
					path: '/',
					name: 'FIXTURE',
					replace: false,
				},
			}
const broker = new BrokerDialog(
	binding,
	async (operation, _id, _input, signal) => {
		if (operation === 'get') {
			assert.ok(signal)
			return new Promise((_resolve, reject) => {
				signal.addEventListener(
					'abort',
					() => reject(new Error('Fixture poll stopped.')),
					{ once: true },
				)
			})
		}
		return {
			id: dialogId(binding),
			kind,
			policy: kind === 'question' ? 'ordinary' : 'local',
		}
	},
)
const show = async () => {
	throw new Error('Fixture UI unavailable.')
}
await assert.rejects(
	kind === 'question'
		? brokerQuestionnaire(broker, questions, show, undefined)
		: secretSession(broker, 'FIXTURE', show, undefined),
	/Fixture UI unavailable/,
)
await setImmediate()
