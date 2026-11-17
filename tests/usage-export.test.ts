import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('usage exporter production CLI satisfies the isolated usage and privacy contract', () => {
	const proof = spawnSync(
		'python3',
		[
			'-B',
			'-m',
			'unittest',
			'discover',
			'-s',
			'tests/usage_export',
			'-p',
			'test_*.py',
		],
		{ encoding: 'utf8', timeout: 60_000 },
	)
	assert.equal(proof.status, 0, proof.stdout + proof.stderr)
})
