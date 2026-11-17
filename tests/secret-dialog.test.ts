import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SecretDialog } from '../extensions/ui/ask-user-secret/secret-dialog.ts'

for (const [label, entry] of [
	['whitespace-only', '   '],
	['NUL', 'fixture\u0000entry'],
] as const) {
	test(`terminal refuses ${label} secrets and still accepts a valid replacement`, context => {
		const submitted: (string | undefined)[] = []
		const dialog = new SecretDialog(
			{ requestRender: () => undefined },
			{ kind: 'token', purpose: 'Fixture', destination: 'Fixture' },
			secret => submitted.push(secret),
		)
		context.after(() => dialog.dispose())
		dialog.handleInput('\u001b[200~')
		dialog.handleInput(entry)
		dialog.handleInput('\u001b[201~')
		dialog.handleInput('\r')
		assert.deepEqual(submitted, [])
		dialog.handleInput('\u0015')
		dialog.handleInput('valid-fixture')
		dialog.handleInput('\r')
		assert.deepEqual(submitted, ['valid-fixture'])
	})
}
