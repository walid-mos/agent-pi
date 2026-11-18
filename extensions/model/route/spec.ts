import { join } from 'node:path'

import { Type } from 'typebox'

import { readCheckedJson } from '#lib/checked-json.ts'
import { overlayFiles } from '#lib/client-overlays.ts'
import { GROUP_PREFIX } from '#lib/magpie.ts'

import type { Static } from 'typebox'

export const SPEC_FILE = 'magpie-routing.json'
/** Magpie refuses a longer intent. */
const MAX_INTENT_LENGTH = 200
export const NO_TOKEN_FLOOR = 0

const GroupReference = Type.String({ pattern: `^${GROUP_PREFIX}[a-z0-9-]+$` })
const NonEmptyStrings = Type.Array(Type.String({ minLength: 1 }), {
	minItems: 1,
})
/** Magpie takes a scope's folders as one comma-separated value. */
const Folders = Type.Array(Type.String({ pattern: '^[^,]+$' }), {
	minItems: 1,
})

const RoutingRuleSchema = Type.Object(
	{
		intent: Type.Optional(Type.String({ minLength: 1 })),
		scope: Type.Optional(Type.String({ minLength: 1 })),
		tokens: Type.Optional(Type.Integer({ minimum: 1 })),
		use: Type.Array(GroupReference, { minItems: 1, uniqueItems: true }),
	},
	{ additionalProperties: false },
)

const RoutingSpecSchema = Type.Object(
	{
		group: Type.String({ pattern: '^[a-z0-9-]+$' }),
		classifier: Type.String({ minLength: 1 }),
		intentSure: Type.Number({ minimum: 0, maximum: 1 }),
		members: Type.Array(GroupReference, { minItems: 1, uniqueItems: true }),
		scopes: Type.Record(Type.String(), Folders),
		intents: Type.Record(
			Type.String(),
			Type.String({ minLength: 1, maxLength: MAX_INTENT_LENGTH }),
		),
		rules: Type.Array(RoutingRuleSchema, { minItems: 1 }),
		pins: Type.Record(Type.String(), NonEmptyStrings),
	},
	{ additionalProperties: false },
)

const RoutingOverlaySchema = Type.Object(
	{
		scopes: Type.Optional(Type.Record(Type.String(), Folders)),
		rules: Type.Optional(Type.Array(RoutingRuleSchema)),
	},
	{ additionalProperties: false },
)

export type RoutingRule = Static<typeof RoutingRuleSchema>
export type RoutingSpec = Static<typeof RoutingSpecSchema>
type RoutingOverlay = Static<typeof RoutingOverlaySchema>

function unknownMembers(spec: RoutingSpec, groups: string[]): string[] {
	return groups.filter(group => !spec.members.includes(group))
}

function ruleProblems(
	spec: RoutingSpec,
	rule: RoutingRule,
	index: number,
): string[] {
	const where = `rules[${index}]`
	const problems = unknownMembers(spec, rule.use).map(
		group => `${where} uses ${group}, not a member`,
	)
	if (!rule.intent && !rule.scope)
		problems.push(
			`${where} has no intent or scope: it would catch every turn`,
		)
	if (rule.intent && !Object.hasOwn(spec.intents, rule.intent))
		problems.push(`${where} names unknown intent "${rule.intent}"`)
	if (rule.scope && !Object.hasOwn(spec.scopes, rule.scope))
		problems.push(`${where} names unknown scope "${rule.scope}"`)
	return problems
}

/** Magpie takes the first rule that holds: one behind a rule with the same intent and scope and no higher floor never does. */
function shadowedRules(rules: RoutingRule[]): string[] {
	return rules.flatMap((rule, index) => {
		const shadow = rules.findIndex(
			(earlier, earlierIndex) =>
				earlierIndex < index &&
				earlier.intent === rule.intent &&
				earlier.scope === rule.scope &&
				(earlier.tokens ?? NO_TOKEN_FLOOR) <=
					(rule.tokens ?? NO_TOKEN_FLOOR),
		)
		if (shadow === -1) return []
		return [`rules[${index}] never holds: rules[${shadow}] comes first`]
	})
}

type RuleSource = { path: string; rules: RoutingRule[] }

function specProblems(
	spec: RoutingSpec,
	basePath: string,
	sources: RuleSource[],
): string[] {
	const ruleFaults = sources.flatMap(({ path, rules }) =>
		[
			...rules.flatMap((rule, index) => ruleProblems(spec, rule, index)),
			...shadowedRules(rules),
		].map(problem => `${path}: ${problem}`),
	)
	const pinFaults = unknownMembers(spec, Object.keys(spec.pins)).map(
		group => `${basePath}: pins.${group} is not a member`,
	)
	const classifierFaults = spec.rules.some(rule => rule.intent)
		? []
		: [`${basePath}: no rule has an intent: the classifier would never run`]
	return [...ruleFaults, ...pinFaults, ...classifierFaults]
}

function withOverlayScopes(
	spec: RoutingSpec,
	overlay: RoutingOverlay,
	path: string,
): RoutingSpec {
	const scopes = overlay.scopes ?? {}
	const clashes = Object.keys(scopes).filter(scope =>
		Object.hasOwn(spec.scopes, scope),
	)
	if (clashes.length)
		throw new Error(`${path} redefines scope ${clashes.join(', ')}`)
	return { ...spec, scopes: { ...spec.scopes, ...scopes } }
}

export function loadRoutingSpec(agentDir: string): RoutingSpec {
	const path = join(agentDir, SPEC_FILE)
	const base = readCheckedJson(path, RoutingSpecSchema)
	const overlays = overlayFiles(agentDir, SPEC_FILE).map(overlayPath => ({
		path: overlayPath,
		overlay: readCheckedJson(overlayPath, RoutingOverlaySchema),
	}))
	const sources: RuleSource[] = [
		{ path, rules: base.rules },
		...overlays.map(overlay => ({
			path: overlay.path,
			rules: overlay.overlay.rules ?? [],
		})),
	]
	const firstScoped = base.rules.findIndex(rule => rule.scope)
	const insertAt = firstScoped === -1 ? base.rules.length : firstScoped
	const spec = {
		...overlays.reduce<RoutingSpec>(
			(current, overlay) =>
				withOverlayScopes(current, overlay.overlay, overlay.path),
			base,
		),
		rules: base.rules.toSpliced(
			insertAt,
			0,
			...sources.slice(1).flatMap(source => source.rules),
		),
	}
	const problems = specProblems(spec, path, sources)
	if (problems.length)
		throw new Error(
			problems.map(problem => `invalid ${problem}`).join('; '),
		)
	return spec
}
