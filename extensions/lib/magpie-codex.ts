import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { errorText } from './error-text.ts'
import { magpieProvidersPath, readMagpieGroups } from './magpie-groups.ts'

import type { Static } from 'typebox'
import type { MagpieGroup } from './magpie-groups.ts'

export const CODEX_GROUP_PREFIX = 'codex-group/'
const CODEX_MEMBER_PREFIX = 'codex/'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const EffortSchema = Type.Union(EFFORTS.map(effort => Type.Literal(effort)))

type CodexSelection = {
	provider: 'openai-codex'
	id: string
	thinkingLevel: Static<typeof EffortSchema>
}

function readGroups(group: string, path: string): MagpieGroup[] {
	try {
		return readMagpieGroups(path)
	} catch (error) {
		throw new Error(
			`Cannot resolve Codex group ${group}: ${errorText(error)}`,
			{ cause: error },
		)
	}
}

export function resolveCodexGroup(
	group: string,
	path = magpieProvidersPath(),
): CodexSelection {
	const groups = readGroups(group, path)
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
			`Magpie configuration ${path}: group ${group} needs a non-Anthropic Codex model with a Pi-supported effort (${EFFORTS.join(', ')}).`,
		)
	return { provider: 'openai-codex', id, thinkingLevel }
}
