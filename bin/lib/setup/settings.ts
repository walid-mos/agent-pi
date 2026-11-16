import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { isJsonObject, readJsonObject, writeJsonObject } from './json-object.ts'
import { planPackages } from './package-settings.ts'
import { SETTINGS_FILES } from './settings-files.ts'

import type { JsonObject } from './json-object.ts'

type SettingsPlan = {
	settings: JsonObject
	ownership: JsonObject
	message: string
	isChanged: boolean
}

function merge(base: JsonObject, override: JsonObject): JsonObject {
	const merged: JsonObject = { ...base }
	for (const [key, value] of Object.entries(override)) {
		const current = merged[key]
		merged[key] =
			isJsonObject(current) && isJsonObject(value)
				? merge(current, value)
				: value
	}
	return merged
}

function changedKeys(before: JsonObject, after: JsonObject): string[] {
	return Object.keys(after).filter(
		key => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
	)
}

function updateMessage(source: string, reset: string[]): string {
	const { live, pinned, defaults } = SETTINGS_FILES
	if (source === defaults) return `${live} created from ${defaults} and ${pinned}`
	if (!reset.length) return `${live} already matches ${pinned}`
	return `${live}: reset to ${pinned}: ${reset.join(', ')}`
}

export function pinnedSettings(
	agentDirectory: string,
	overlayRoots: string[],
): SettingsPlan {
	const settingsPath = join(agentDirectory, SETTINGS_FILES.live)
	const isExisting = existsSync(settingsPath)
	const source = isExisting ? SETTINGS_FILES.live : SETTINGS_FILES.defaults
	const live = readJsonObject(join(agentDirectory, source))
	const pinned = readJsonObject(join(agentDirectory, SETTINGS_FILES.pinned))
	const { packages, ownership } = planPackages(agentDirectory, pinned, live, overlayRoots)
	const settings = merge(live, { ...pinned, packages })
	const reset = changedKeys(live, settings)
	return {
		settings,
		ownership,
		message: updateMessage(source, reset),
		isChanged: !isExisting || reset.length > 0,
	}
}

export function applySettings(agentDirectory: string, plan: SettingsPlan): void {
	if (plan.isChanged) writeJsonObject(join(agentDirectory, SETTINGS_FILES.live), plan.settings)
	writeJsonObject(join(agentDirectory, SETTINGS_FILES.ownership), plan.ownership)
	console.log(plan.message)
}
