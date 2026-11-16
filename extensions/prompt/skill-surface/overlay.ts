import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { readCheckedJson } from '#lib/checked-json.ts'
import { overlayFiles } from '#lib/client-overlays.ts'

import { skillSurfaceConfigSchema } from './scope.ts'

import type { SkillSurfaceConfig } from './scope.ts'

const CONFIG_FILE = 'skills.json'

function mergeRecords<Entry>(
	base: Record<string, Entry> | undefined,
	overlay: Record<string, Entry> | undefined,
	label: string,
	file: string,
): Record<string, Entry> {
	const clashes = Object.keys(overlay ?? {}).filter(
		key => base && Object.hasOwn(base, key),
	)
	if (clashes.length)
		throw new Error(`${file} redefines ${label} ${clashes.join(', ')}`)
	return { ...base, ...overlay }
}

function mergeSkillSurfaceConfig(
	base: SkillSurfaceConfig,
	file: string,
): SkillSurfaceConfig {
	const overlay = readCheckedJson(file, skillSurfaceConfigSchema)
	return {
		hidden: [...(base.hidden ?? []), ...(overlay.hidden ?? [])],
		projects: mergeRecords(
			base.projects,
			overlay.projects,
			'project',
			file,
		),
		autoload: mergeRecords(
			base.autoload,
			overlay.autoload,
			'autoload',
			file,
		),
	}
}

export function loadSkillSurfaceConfig(agentDir: string): SkillSurfaceConfig {
	const path = join(agentDir, CONFIG_FILE)
	const base = existsSync(path) ? [path] : []
	return [...base, ...overlayFiles(agentDir, CONFIG_FILE)].reduce(
		mergeSkillSurfaceConfig,
		{},
	)
}
