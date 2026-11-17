import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const scenarios = [
	[
		'abort',
		'a user abort during a model switch leaves no hidden fallback restoration',
	],
	[
		'session',
		'a late failover switch cannot reactivate fallback in a new session',
	],
	[
		'watchdog-session',
		'a late watchdog switch cannot reactivate fallback in a new session',
	],
	[
		'success',
		'a successful failover retains restoration and publishes its continuation and status',
	],
	[
		'watchdog-success',
		'watchdog recovery continues after its own abort and retains restoration and status',
	],
] as const

for (const [scenario, requirement] of scenarios) {
	test(requirement, () => {
		const execution = spawnSync(
			process.execPath,
			[
				'--experimental-transform-types',
				new URL('./fixtures/failover-race.mjs', import.meta.url)
					.pathname,
				scenario,
			],
			{ encoding: 'utf8', timeout: 30_000 },
		)
		assert.equal(
			execution.status,
			0,
			execution.stderr || execution.error?.message,
		)
	})
}
