import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { writeAtomically } from './atomic-write.ts'
import { requireProjectAccess } from '../../security/infisical-access.ts'
import { parseSecretTarget } from '../../security/infisical-target.ts'
import { call, HTTP_NOT_FOUND, HTTP_OK, query, secretsApi } from '../../security/infisical-rest.ts'
import { AGENT_SECRETS_DIR, machineToken, vaultBinding } from '../../security/machine-identity.ts'
import protocol from '../../security/machine-identity.json' with { type: 'json' }

const CREDENTIAL_NAMES = [protocol.clientIdVariable, protocol.clientSecretVariable]
const MISSING_CREDENTIALS = 'The publisher machine credentials are missing. Run pi-token-sync-install from an authorized shell'
const MALFORMED = 'The published Codex token is malformed'
const REPUBLISH = 'Run pi-token-sync --publish on the machine that signed in'

export const PROVIDER = 'openai-codex'
export const AUTH_FILE = join(getAgentDir(), 'auth.json')
const JOB_CREDENTIALS_FILE = join(AGENT_SECRETS_DIR, 'pi-token-sync.json')
const MIN_VALIDITY_MS = 5 * 60 * 1000
export const JOB_INTERVAL_SECONDS = 3600
export const PUBLISH_VALIDITY_MS = 2 * JOB_INTERVAL_SECONDS * 1000 + MIN_VALIDITY_MS

export class TokenSyncError extends Error {}

export function writePrivately(path, text) {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
	writeAtomically(path, text, 0o600)
}

export function jobCredentials() {
	const credentials = Object.fromEntries(CREDENTIAL_NAMES.map(name => [name, process.env[name]]))
	if (CREDENTIAL_NAMES.some(name => !credentials[name]))
		throw new TokenSyncError('Export the Infisical machine client ID and client secret in this shell before installing. No values were printed')
	return credentials
}

export function saveJobCredentials(credentials) {
	writePrivately(JOB_CREDENTIALS_FILE, JSON.stringify(credentials))
}

export function loadJobCredentials() {
	if (!existsSync(JOB_CREDENTIALS_FILE)) throw new TokenSyncError(MISSING_CREDENTIALS)
	const permissions = statSync(JOB_CREDENTIALS_FILE)
	if (!permissions.isFile() || permissions.uid !== process.getuid() || (permissions.mode & 0o077) !== 0)
		throw new TokenSyncError('The publisher machine-credential file must be owned by this user and private. Run pi-token-sync-install again')
	const credentials = JSON.parse(readFileSync(JOB_CREDENTIALS_FILE, 'utf8'))
	for (const name of CREDENTIAL_NAMES) {
		if (typeof credentials[name] !== 'string' || !credentials[name]) throw new TokenSyncError(MISSING_CREDENTIALS)
		process.env[name] = credentials[name]
	}
}

export function readAuth() {
	return existsSync(AUTH_FILE) ? JSON.parse(readFileSync(AUTH_FILE, 'utf8')) : {}
}

export function ownsSignIn(entry) {
	return entry?.type === 'oauth' && Boolean(entry.refresh)
}

export function publication(entry) {
	const isValid = entry && typeof entry === 'object' &&
		typeof entry.access === 'string' && entry.access.trim() &&
		typeof entry.accountId === 'string' && entry.accountId.trim() &&
		Number.isFinite(entry.expires) && !entry.refresh
	if (!isValid) throw new TokenSyncError(MALFORMED)
	if (entry.expires <= Date.now() + MIN_VALIDITY_MS)
		throw new TokenSyncError(`The published Codex token is expired or near expiry: it needs more than ${MIN_VALIDITY_MS / 60_000} minutes of validity. ${REPUBLISH}`)
	return { access: entry.access, accountId: entry.accountId, expires: entry.expires }
}

export function log(message) {
	console.log(`${new Date().toISOString()} ${message}`)
}

export function fail(error) {
	const message = error instanceof TokenSyncError ? error.message :
		'Codex token sync failed. Check the vault binding, machine credentials, network and private auth.json. No values were printed'
	console.error(message)
	process.exitCode = 1
}

export async function openVault() {
	const binding = vaultBinding()
	const client = binding?.clients?.pi
	const { workspaceId, environment, path, name } = parseSecretTarget({
		...binding,
		path: client?.path,
		name: client?.oauth?.codex,
	})
	const token = await machineToken()
	await requireProjectAccess(token, workspaceId)
	return {
		token,
		path,
		url: `${secretsApi()}/${encodeURIComponent(name)}`,
		where: { workspaceId, environment, type: 'shared' },
	}
}

export function getSecret(vault) {
	return call(vault.token, 'GET', `${vault.url}?${query(vault.where, vault.path)}`)
}

export function writeSecret(vault, method, secretValue) {
	return call(vault.token, method, vault.url, { ...vault.where, secretPath: vault.path, secretValue })
}

export async function readPublication(vault) {
	const response = await getSecret(vault)
	if (response.status === HTTP_NOT_FOUND) throw new TokenSyncError(`No Codex token is published. ${REPUBLISH}`)
	if (response.status !== HTTP_OK) throw new TokenSyncError(`Infisical refused the Codex token: HTTP ${response.status}`)
	return publication(publishedEntry(response.json))
}

function publishedEntry(body) {
	const value = body?.secret?.secretValue
	if (typeof value !== 'string') throw new TokenSyncError(MALFORMED)
	try {
		return JSON.parse(value)
	} catch {
		throw new TokenSyncError(MALFORMED)
	}
}
