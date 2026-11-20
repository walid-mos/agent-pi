import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturePath = fileURLToPath(import.meta.url)

export function installFakeGh(bin: string): Record<string, string> {
	writeFileSync(
		join(bin, 'gh'),
		'#!/bin/sh\nexec "$FAKE_GH_NODE" "$FAKE_GH_MODULE" "$@"\n',
		{ mode: 0o755 },
	)
	return { FAKE_GH_NODE: process.execPath, FAKE_GH_MODULE: fixturePath }
}

function runFakeGh(command: string[]): void {
	const calls = process.env.FAKE_GH_CALLS
	if (!calls) throw new Error('fake gh: FAKE_GH_CALLS is required')
	appendFileSync(calls, `${JSON.stringify(command)}\n`)

	const [group, action] = command
	const replies = new Map([
		['pr list', process.env.FAKE_GH_OPEN_PULL_REQUEST ?? ''],
		['repo view', 'main'],
		['pr create', process.env.FAKE_GH_CREATED_PULL_REQUEST],
	])
	const reply = replies.get(`${group} ${action}`)
	if (typeof reply !== 'string') {
		throw new Error(`fake gh: unexpected call ${JSON.stringify(command)}`)
	}
	process.stdout.write(`${reply}\n`)
}

if (import.meta.main) {
	const [, , ...command] = process.argv
	runFakeGh(command)
}
