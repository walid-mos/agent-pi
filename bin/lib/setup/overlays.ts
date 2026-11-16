import { existsSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

import { isJsonObject, isStringArray, readJsonObject } from './json-object.ts'

import type { JsonObject } from './json-object.ts'

function isDirectory(path: string): boolean {
	return existsSync(path) && statSync(path).isDirectory()
}

type ResourceCheck = [isValid: (path: string) => boolean, fault: string]
type SkillDiagnostic = ReturnType<
	typeof import('@earendil-works/pi-coding-agent').loadSkills
>['diagnostics'][number]

const RESOURCE_CHECKS: Record<string, ResourceCheck> = {
	skills: [isDirectory, 'is not a directory'],
	extensions: [existsSync, 'does not exist'],
	prompts: [existsSync, 'does not exist'],
	themes: [existsSync, 'does not exist'],
}

function isInside(directories: string[], path: string): boolean {
	return directories.some(
		(directory) => path === directory || path.startsWith(`${directory}${sep}`),
	)
}

function rootProblems(root: string): string[] {
	const manifestPath = join(root, 'package.json')
	if (!isDirectory(root)) return [`${root} is not a directory`]
	if (!existsSync(manifestPath)) return [`${root} has no package.json`]
	const pi = readJsonObject(manifestPath).pi
	if (!isJsonObject(pi)) return [`${manifestPath} has no "pi" manifest`]
	return Object.entries(RESOURCE_CHECKS).flatMap(([key, check]) =>
		resourceProblems(root, manifestPath, key, pi[key], check),
	)
}

function resourceProblems(
	root: string,
	manifestPath: string,
	key: string,
	declared: unknown,
	[isValid, fault]: ResourceCheck,
): string[] {
	const entries = declared ?? []
	if (!isStringArray(entries))
		return [`${manifestPath}: pi.${key} must be an array of paths`]
	return entries
		.map((entry) => resolve(root, entry))
		.filter((path) => !isValid(path))
		.map((path) => `${manifestPath}: pi.${key} entry ${path} ${fault}`)
}

function duplicateRootProblems(roots: string[]): string[] {
	const firstSpelling = new Map<string, string>()
	return roots.filter(isDirectory).flatMap((root) => {
		const real = realpathSync(root)
		const first = firstSpelling.get(real)
		if (first === undefined) {
			firstSpelling.set(real, root)
			return []
		}
		return [`${root} and ${first} are the same directory`]
	})
}

/** Setup imports typebox and Pi dynamically: they exist only after the install. */
export async function registeredOverlayRoots(
	agentDirectory: string,
): Promise<string[]> {
	const { registeredOverlays } = await import('#lib/client-overlays.ts')
	return registeredOverlays(agentDirectory)
}

function describeSkillDiagnostic({ collision, path, message }: SkillDiagnostic): string {
	if (collision)
		return `skill ${collision.name} is defined in ${collision.winnerPath} and in ${collision.loserPath}`
	return `${path ?? 'skill'}: ${message}`
}

async function skillProblems(
	agentDirectory: string,
	roots: string[],
	settings: JsonObject,
): Promise<string[]> {
	const { DefaultPackageManager, SettingsManager, loadSkills } = await import(
		'@earendil-works/pi-coding-agent'
	)
	const manager = new DefaultPackageManager({
		cwd: agentDirectory,
		agentDir: agentDirectory,
		settingsManager: SettingsManager.inMemory(settings),
	})
	const { skills } = await manager.resolve(async () => 'skip')
	const { diagnostics } = loadSkills({
		cwd: agentDirectory,
		agentDir: agentDirectory,
		skillPaths: skills.filter((skill) => skill.enabled).map((skill) => skill.path),
		includeDefaults: false,
	})
	const managed = [agentDirectory, ...roots.filter(isDirectory)].flatMap((directory) => [
		directory,
		realpathSync(directory),
	])
	const isManaged = (path: string | undefined): boolean =>
		path !== undefined && isInside(managed, path)
	return diagnostics.flatMap((diagnostic) => {
		const { collision, path } = diagnostic
		const paths = collision ? [collision.winnerPath, collision.loserPath] : [path]
		const text = describeSkillDiagnostic(diagnostic)
		if (paths.every(isManaged)) return [text]
		console.warn(`warning: ${text}`)
		return []
	})
}

export async function checkOverlayRoots(
	agentDirectory: string,
	roots: string[],
	settings: JsonObject,
): Promise<void> {
	const problems = [
		...roots.flatMap(rootProblems),
		...duplicateRootProblems(roots),
		...(await skillProblems(agentDirectory, roots, settings)),
	]
	if (problems.length > 0)
		throw new Error(`invalid Pi resources:\n- ${problems.join('\n- ')}`)
}

export async function checkOverlayConfig(agentDirectory: string): Promise<void> {
	const { loadSkillSurfaceConfig } = await import(
		'../../../extensions/prompt/skill-surface/overlay.ts'
	)
	const { loadRoutingSpec } = await import(
		'../../../extensions/model/route/spec.ts'
	)
	loadSkillSurfaceConfig(agentDirectory)
	loadRoutingSpec(agentDirectory)
}
