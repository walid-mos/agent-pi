import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { isJsonObject, isStringArray, readJsonObject } from './json-object.ts'
import { SETTINGS_FILES } from './settings-files.ts'

import type { JsonObject } from './json-object.ts'

type PackageEntry = string | (JsonObject & { source: string })

function isPackageEntry(entry: unknown): entry is PackageEntry {
	return typeof entry === 'string' || (isJsonObject(entry) && typeof entry.source === 'string')
}

function packageEntries(settings: JsonObject, file: string): PackageEntry[] {
	const { packages = [] } = settings
	if (!Array.isArray(packages) || !packages.every(isPackageEntry))
		throw new Error(`${file}: packages must be an array of strings or objects with a string source.`)
	return packages
}

function packageSource(entry: PackageEntry): string {
	return typeof entry === 'string' ? entry : entry.source
}

function previousSources(agentDirectory: string): string[] {
	const path = join(agentDirectory, SETTINGS_FILES.ownership)
	if (!existsSync(path)) return []
	const packages = readJsonObject(path).packages
	if (!isStringArray(packages))
		throw new Error(`${path}: packages must be an array of managed source strings.`)
	return packages
}

function mergePackages(
	live: PackageEntry[],
	managed: PackageEntry[],
	previous: string[],
): PackageEntry[] {
	const managedSources = new Set([...previous, ...managed.map(packageSource)])
	const filtered = new Map(
		live
			.filter(entry => typeof entry !== 'string')
			.map(entry => [packageSource(entry), entry]),
	)
	return [
		...live.filter(entry => !managedSources.has(packageSource(entry))),
		...managed.map(entry =>
			typeof entry === 'string' ? (filtered.get(entry) ?? entry) : entry,
		),
	]
}

export function planPackages(
	agentDirectory: string,
	pinned: JsonObject,
	live: JsonObject,
	overlayRoots: string[],
): { packages: PackageEntry[]; ownership: JsonObject } {
	const managed = [...packageEntries(pinned, SETTINGS_FILES.pinned), ...overlayRoots]
	return {
		packages: mergePackages(
			packageEntries(live, SETTINGS_FILES.live),
			managed,
			previousSources(agentDirectory),
		),
		ownership: { packages: managed.map(packageSource) },
	}
}
