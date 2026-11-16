import { parseJson } from '#lib/parse-json.ts'

import { writeAtomically } from '../atomic-write.ts'

export type JsonObject = Record<string, unknown>

const JSON_INDENT = 2

export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

export function readJsonObject(path: string): JsonObject {
	const parsed = parseJson(path)
	if (!isJsonObject(parsed))
		throw new Error(`${path} must hold a JSON object; fix or delete it.`)
	return parsed
}

export function serializeJson(value: JsonObject): string {
	return `${JSON.stringify(value, null, JSON_INDENT)}\n`
}

export function writeJsonObject(path: string, value: JsonObject): void {
	writeAtomically(path, serializeJson(value))
}
