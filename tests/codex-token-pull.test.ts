import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const puller = resolve('bin/pi-token-pull')
const now = 1_800_000_000_000
const fresh = {
	access: 'fixture-access',
	accountId: 'fixture-account',
	expires: now + 3_600_000,
}
const local = { unrelated: { type: 'api_key', key: 'fixture-other' } }

function pull(
	publication: unknown,
	auth: object = local,
): {
	status: number | null
	output: string
	auth: string
	before: string
} {
	const directory = mkdtempSync(join(tmpdir(), 'codex-pull-'))
	try {
		const agent = join(directory, '.pi', 'agent')
		const binding = join(directory, '.config', 'agent-secrets')
		mkdirSync(agent, { recursive: true })
		mkdirSync(binding, { recursive: true })
		writeFileSync(
			join(binding, 'core-vault.json'),
			JSON.stringify({
				domain: 'https://vault.invalid',
				projectId: 'fixture-project',
				environment: 'fixture',
				clients: {
					pi: { path: '/fixture', oauth: { codex: 'FIXTURE_CODEX' } },
				},
			}),
		)
		const before = JSON.stringify(auth)
		writeFileSync(join(agent, 'auth.json'), before)
		const preload = join(directory, 'network.mjs')
		writeFileSync(
			preload,
			`
Date.now = () => ${now};
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/auth/universal-auth/login')) return Response.json({ accessToken: 'fixture-machine' });
  if (String(url).endsWith('/v1/projects/fixture-project')) return Response.json({});
  if (String(url).includes('/v3/secrets/raw/FIXTURE_CODEX?')) return Response.json({ secret: { secretValue: ${JSON.stringify(typeof publication === 'string' ? publication : JSON.stringify(publication))} } });
  throw new Error('unexpected network request');
};
`,
		)
		const execution = spawnSync(
			process.execPath,
			['--import', preload, puller],
			{
				encoding: 'utf8',
				timeout: 30_000,
				env: {
					...process.env,
					HOME: directory,
					PI_CODING_AGENT_DIR: agent,
					INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: 'fixture-id',
					INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET:
						'fixture-machine-secret',
				},
			},
		)
		return {
			status: execution.status,
			output: execution.stdout + execution.stderr,
			auth: readFileSync(join(agent, 'auth.json'), 'utf8'),
			before,
		}
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

for (const expires of [now - 1, now + 299_999, now + 300_000]) {
	test(`refuses stale publication expiring at ${expires} without changing auth`, () => {
		const execution = pull({ ...fresh, expires })
		assert.equal(execution.status, 1)
		assert.match(execution.output, /expired|near|five minutes/u)
		assert.match(execution.output, /pi-token-sync --publish/u)
		assert.equal(execution.auth, execution.before)
		assert.ok(!execution.output.includes(fresh.access))
	})
}

test('imports fresh access-only auth while preserving other providers', () => {
	const execution = pull(fresh)
	assert.equal(execution.status, 0, execution.output)
	assert.deepEqual(JSON.parse(execution.auth), {
		...local,
		'openai-codex': { type: 'oauth', ...fresh, refresh: '' },
	})
	assert.ok(!execution.output.includes(fresh.access))
})

test('preserves a machine-owned refresh-bearing sign-in', () => {
	const execution = pull(fresh, {
		...local,
		'openai-codex': {
			type: 'oauth',
			access: 'fixture-local',
			refresh: 'fixture-refresh',
			expires: now - 1,
		},
	})
	assert.equal(execution.status, 0, execution.output)
	assert.equal(execution.auth, execution.before)
})

test('rejects malformed JSON without printing its input', () => {
	const execution = pull('{"access":"fixture-credential-in-malformed-json"')
	assert.equal(execution.status, 1)
	assert.equal(execution.auth, execution.before)
	assert.ok(
		!execution.output.includes('fixture-credential-in-malformed-json'),
	)
})
