import { appendFileSync } from 'node:fs'

const [, , ...command] = process.argv
appendFileSync(process.env.FAKE_GH_CALLS, `${JSON.stringify(command)}\n`)

const replies = {
	'pr list': process.env.FAKE_GH_OPEN_PULL_REQUEST ?? '',
	'repo view': 'main',
	'pr create': 'https://github.invalid/fixture/repository/pull/1',
}
const [group, action] = command
const reply = replies[`${group} ${action}`]
if (reply === undefined) {
	process.stderr.write(
		`fake gh: unexpected call ${JSON.stringify(command)}\n`,
	)
	process.exit(1)
}
process.stdout.write(`${reply}\n`)
