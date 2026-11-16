import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { Type } from 'typebox'

import { readCheckedJson } from './checked-json.ts'

const CLIENT_DIRECTORY = 'client'
const OVERLAYS_FILE = 'overlays.json'

const OverlayRootsSchema = Type.Array(Type.String({ pattern: '^/' }), {
	uniqueItems: true,
})

function clientFiles(agentDir: string, fileName: string): string[] {
	const root = join(agentDir, CLIENT_DIRECTORY)
	if (!existsSync(root)) return []
	return readdirSync(root, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => join(root, entry.name, fileName))
		.filter(path => existsSync(path))
		.toSorted()
}

export function registeredOverlays(agentDir: string): string[] {
	const path = join(agentDir, OVERLAYS_FILE)
	if (!existsSync(path)) return []
	return readCheckedJson(path, OverlayRootsSchema)
}

export function overlayFiles(agentDir: string, fileName: string): string[] {
	const rootFiles = registeredOverlays(agentDir)
		.map(root => join(root, fileName))
		.filter(path => existsSync(path))
	return [...clientFiles(agentDir, fileName), ...rootFiles]
}
