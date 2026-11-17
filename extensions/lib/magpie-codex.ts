import { homedir } from 'node:os'
import { join } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { readCheckedJson } from './checked-json.ts'

import type { Static } from 'typebox'

export const CODEX_GROUP_PREFIX = 'codex-group/'
const CODEX_MEMBER_PREFIX = 'codex/'
const GroupsSchema = Type.Object({
	groups: Type.Array(
		Type.Object({ id: Type.String(), members: Type.Array(Type.String()) }),
	),
})
const EffortSchema = Type.Union([
	Type.Literal('low'),
	Type.Literal('medium'),
	Type.Literal('high'),
	Type.Literal('xhigh'),
	Type.Literal('max'),
])

type CodexSelection = {
	provider: 'openai-codex'
	id: string
	thinkingLevel: Static<typeof EffortSchema>
}

export function magpieProvidersPath(home = homedir()): string {
	return join(home, '.config', 'magpie', 'providers.json')
}

function readGroups(group: string, path: string): Static<typeof GroupsSchema> {
	try {
		return readCheckedJson(path, GroupsSchema)
	} catch {
		// Magpie stores provider keys beside groups, so parser errors must not escape.
		throw new Error(
			`Cannot resolve Codex group ${group}: read valid Magpie groups from ${path}. Restore or seed the Magpie configuration.`,
		)
	}
}

export function resolveCodexGroup(
	group: string,
	path = magpieProvidersPath(),
): CodexSelection {
	const { groups } = readGroups(group, path)
	const stored = groups.find(candidate => candidate.id === group)
	if (!stored)
		throw new Error(
			`Magpie configuration ${path}: missing group ${group}. Restore or seed it.`,
		)
	const member = stored.members.find(candidate =>
		candidate.startsWith(CODEX_MEMBER_PREFIX),
	)
	if (!member)
		throw new Error(
			`Magpie configuration ${path}: group ${group} has no Codex member. Add a codex/model:effort member.`,
		)
	const [id = '', thinkingLevel, extra] = member
		.slice(CODEX_MEMBER_PREFIX.length)
		.split(':')
	if (
		!/^[^:\s]+$/.test(id) ||
		/^(claude|anthropic)([-/]|$)/i.test(id) ||
		extra ||
		!Value.Check(EffortSchema, thinkingLevel)
	)
		throw new Error(
			`Magpie configuration ${path}: group ${group} needs a non-Anthropic Codex model with a Pi-supported effort (low, medium, high, xhigh, max).`,
		)
	return { provider: 'openai-codex', id, thinkingLevel }
}
