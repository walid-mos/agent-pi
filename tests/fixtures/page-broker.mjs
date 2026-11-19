import { createHash } from 'node:crypto'
import { createConnection } from 'node:net'

const DIALOG_ID_LENGTH = 32

async function readInput() {
	const chunks = []
	for await (const chunk of process.stdin) chunks.push(chunk)
	if (!chunks.length) return undefined
	return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function handOff(target, packet) {
	return new Promise((resolve, reject) => {
		const connection = createConnection(target.socket)
		const replies = []
		connection.on('connect', () =>
			connection.write(`${JSON.stringify(packet)}\n`),
		)
		connection.on('data', chunk => replies.push(chunk))
		connection.on('error', reject)
		connection.on('close', () =>
			resolve(JSON.parse(Buffer.concat(replies).toString('utf8'))),
		)
	})
}

function reply(receipt) {
	process.stdout.write(JSON.stringify(receipt))
}

async function runPageBroker() {
	const [, , operation, id] = process.argv
	const request = await readInput()
	if (operation === 'cancel')
		return reply({
			id,
			kind: 'secret',
			policy: 'local',
			result: { status: 'cancelled', origin: 'terminal', at: 1 },
		})
	if (operation !== 'open' || request?.target?.destination !== 'browser') {
		process.exitCode = 1
		return undefined
	}
	const dialog = createHash('sha256')
		.update(JSON.stringify(request.source))
		.digest('hex')
		.slice(0, DIALOG_ID_LENGTH)
	const { target, source } = request
	const ack = await handOff(target, {
		version: 1,
		dialog,
		source,
		origin: target.origin,
		capability: target.capability,
		value: process.env.PAGE_BROKER_ENTRY,
	})
	return reply({
		id: dialog,
		kind: 'secret',
		policy: 'local',
		result: {
			status: 'stored',
			origin: 'page',
			at: 1,
			dialog,
			target: { destination: 'browser', origin: target.origin },
			handoff: ack.handoff,
		},
	})
}

await runPageBroker()
