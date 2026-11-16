import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MAGPIE_PROVIDER } from '#lib/magpie.ts'

import {
	isJsonObject,
	readJsonObject,
	serializeJson,
	writeJsonObject,
} from './json-object.ts'

import type { JsonObject } from './json-object.ts'

const PINNED = 'models.pinned.json'
const LIVE = 'models.json'
const MAGPIE_URL_VARIABLE = 'MAGPIE_BASE_URL'
const WEB_PROTOCOLS = new Set(['http:', 'https:'])

type ModelUpdate = {
	path: string
	models: JsonObject
	isChanged: boolean
	source: string
}

function magpieProvider(models: JsonObject, path: string): JsonObject {
	const providers = models.providers
	const provider = isJsonObject(providers)
		? providers[MAGPIE_PROVIDER]
		: undefined
	if (!isJsonObject(provider))
		throw new Error(`${path}: providers.${MAGPIE_PROVIDER} must be an object.`)
	return provider
}

function magpieBaseUrl(provider: JsonObject, path: string): string {
	const url = provider.baseUrl
	if (typeof url !== 'string')
		throw new Error(
			`${path}: providers.${MAGPIE_PROVIDER}.baseUrl must be a string.`,
		)
	return url
}

function assertWebUrl(url: URL): void {
	if (!WEB_PROTOCOLS.has(url.protocol) || url.username || url.password)
		throw new Error(`${MAGPIE_URL_VARIABLE} must be an HTTP(S) URL without credentials.`)
}

function requestedUrl(environment: NodeJS.ProcessEnv): string | undefined {
	const value = environment[MAGPIE_URL_VARIABLE]
	if (!value) return undefined
	if (!URL.canParse(value))
		throw new Error(`${MAGPIE_URL_VARIABLE} must be an HTTP(S) URL.`)
	assertWebUrl(new URL(value))
	return value
}

function selectBaseUrl(
	path: string,
	pinnedProvider: JsonObject,
	pinnedPath: string,
	requested: string | undefined,
	current: string | undefined,
): [url: string, source: string] {
	if (requested !== undefined) return [requested, MAGPIE_URL_VARIABLE]
	if (current !== undefined)
		return [magpieBaseUrl(magpieProvider(readJsonObject(path), path), path), `existing ${LIVE}`]
	return [magpieBaseUrl(pinnedProvider, pinnedPath), PINNED]
}

export function planModels(
	agentDirectory: string,
	environment: NodeJS.ProcessEnv,
): ModelUpdate {
	const pinnedPath = join(agentDirectory, PINNED)
	const path = join(agentDirectory, LIVE)
	const pinned = readJsonObject(pinnedPath)
	const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined
	const pinnedProvider = magpieProvider(pinned, pinnedPath)
	const requested = requestedUrl(environment)
	const [url, source] = selectBaseUrl(path, pinnedProvider, pinnedPath, requested, current)
	const models = {
		...pinned,
		providers: {
			...(isJsonObject(pinned.providers) ? pinned.providers : {}),
			[MAGPIE_PROVIDER]: { ...pinnedProvider, baseUrl: url },
		},
	}
	return { path, models, isChanged: current !== serializeJson(models), source }
}

export function writeModels(update: ModelUpdate): void {
	if (update.isChanged) writeJsonObject(update.path, update.models)
	console.log(`${LIVE} ${update.isChanged ? 'written' : 'already current'}, Magpie URL from ${update.source}`)
}
