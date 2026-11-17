import { homedir } from 'node:os'
import { join } from 'node:path'

import { Type } from 'typebox'

import { readCheckedJson } from './checked-json.ts'

import type { Static } from 'typebox'

const GroupsFileSchema = Type.Object({
	groups: Type.Array(
		Type.Object({
			id: Type.String(),
			members: Type.Optional(Type.Array(Type.String())),
		}),
	),
})

export type MagpieGroup = Static<typeof GroupsFileSchema>['groups'][number]

export function magpieProvidersPath(home = homedir()): string {
	return join(home, '.config', 'magpie', 'providers.json')
}

function readMagpieGroups(path = magpieProvidersPath()): MagpieGroup[] {
	try {
		return readCheckedJson(path, GroupsFileSchema).groups
	} catch {
		// Magpie stores provider keys beside groups, so parser errors must not escape.
		throw new Error(
			`read valid Magpie groups from ${path}. Restore or seed the Magpie configuration.`,
		)
	}
}

export function findMagpieGroup(
	id: string,
	path = magpieProvidersPath(),
): MagpieGroup {
	const group = readMagpieGroups(path).find(candidate => candidate.id === id)
	if (!group)
		throw new Error(
			`Magpie configuration ${path}: missing group ${id}. Restore or seed it.`,
		)
	return group
}
