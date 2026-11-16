/**
 * skill-surface policy, pure: config schema, project detection and the
 * visibility / autoload decisions. No pi, no TUI; the filesystem probes are
 * injected so callers (and a headless check) own the IO.
 */
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { Type } from 'typebox'

import { globToRegExp } from './glob.ts'

import type { Static } from 'typebox'

const names = Type.Array(Type.String({ minLength: 1 }))
const projectSchema = Type.Object(
	{
		markers: Type.Optional(names),
		packageDeps: Type.Optional(names),
		roots: Type.Optional(names),
		skills: Type.Optional(names),
		autoload: Type.Optional(names),
	},
	{ additionalProperties: false },
)
const triggerSchema = Type.Object(
	{
		tools: Type.Optional(names),
		paths: names,
	},
	{ additionalProperties: false },
)
export const skillSurfaceConfigSchema = Type.Object(
	{
		hidden: Type.Optional(names),
		projects: Type.Optional(Type.Record(Type.String(), projectSchema)),
		autoload: Type.Optional(Type.Record(Type.String(), triggerSchema)),
	},
	{ additionalProperties: false },
)
export type SkillSurfaceConfig = Static<typeof skillSurfaceConfigSchema>
type ProjectRule = Static<typeof projectSchema>

/** Tool calls that name a file and therefore can trigger an autoload. */
const PATH_TOOLS = ['read', 'edit', 'write'] as const
export const PATH_TOOL_NAMES: ReadonlySet<string> = new Set(PATH_TOOLS)
const MAX_ANCESTORS = 8

/** `~` and `$AGENT` expand; everything else is taken literally. */
function expandPath(pattern: string, agentDir: string): string {
	if (pattern === '~' || pattern.startsWith('~/'))
		return join(homedir(), pattern.slice(1))
	if (pattern.startsWith('$AGENT'))
		return join(agentDir, pattern.slice('$AGENT'.length))
	return pattern
}

function matchesName(name: string, patterns: readonly string[]): boolean {
	return patterns.some(pattern =>
		pattern.includes('*')
			? globToRegExp(pattern).test(name)
			: pattern === name,
	)
}

export interface Probes {
	exists: (path: string) => boolean
	readText: (path: string) => string | undefined
}

function candidateRoots(cwd: string): string[] {
	const roots: string[] = []
	let current = resolve(cwd)
	for (let depth = 0; depth < MAX_ANCESTORS; depth += 1) {
		roots.push(current)
		const parent = dirname(current)
		if (parent === current) break
		current = parent
	}
	return roots
}

function projectMatches(
	rule: ProjectRule,
	cwd: string,
	agentDir: string,
	probes: Probes,
): boolean {
	const absoluteCwd = resolve(cwd)
	if (
		rule.roots?.some(root => {
			const prefix = resolve(expandPath(root, agentDir))
			return (
				absoluteCwd === prefix || absoluteCwd.startsWith(`${prefix}/`)
			)
		})
	)
		return true
	const roots = candidateRoots(absoluteCwd)
	if (
		rule.markers?.some(marker =>
			roots.some(root => probes.exists(join(root, marker))),
		)
	)
		return true
	if (!rule.packageDeps?.length) return false
	return roots.some(root => {
		const manifest = probes.readText(join(root, 'package.json'))
		if (!manifest) return false
		return (
			rule.packageDeps?.some(dependency =>
				manifest.includes(dependency),
			) === true
		)
	})
}

export interface SurfacePlan {
	/** Project rule names that match the session cwd. */
	projects: string[]
	/** Skills to inject from the first request on. */
	autoload: string[]
	isVisible: (skillName: string) => boolean
}

/** Decide once per session what the catalog shows and what loads up front. */
export function planSurface(
	config: SkillSurfaceConfig,
	cwd: string,
	agentDir: string,
	probes: Probes,
): SurfacePlan {
	const rules = Object.entries(config.projects ?? {})
	const matched = rules.filter(([, rule]) =>
		projectMatches(rule, cwd, agentDir, probes),
	)
	const matchedNames = new Set(matched.map(([name]) => name))
	const hidden = config.hidden ?? []
	return {
		projects: [...matchedNames],
		autoload: matched.flatMap(([, rule]) => rule.autoload ?? []),
		isVisible: skillName => {
			if (matchesName(skillName, hidden)) return false
			const scoped = rules.filter(([, rule]) =>
				matchesName(skillName, rule.skills ?? []),
			)
			if (!scoped.length) return true
			return scoped.some(([name]) => matchedNames.has(name))
		},
	}
}

/** Skills whose trigger matches one tool call on one absolute path. */
export function triggeredSkills(
	config: SkillSurfaceConfig,
	toolName: string,
	path: string,
	agentDir: string,
): string[] {
	if (!isAbsolute(path)) return []
	return Object.entries(config.autoload ?? {})
		.filter(([, trigger]) => {
			const tools = trigger.tools ?? [...PATH_TOOLS]
			if (!tools.includes(toolName)) return false
			return trigger.paths.some(pattern =>
				globToRegExp(expandPath(pattern, agentDir)).test(path),
			)
		})
		.map(([skillName]) => skillName)
}
