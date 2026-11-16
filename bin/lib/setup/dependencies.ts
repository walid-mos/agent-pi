import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const LOCKFILE = 'pnpm-lock.yaml'

function packageRoots(agentDirectory: string): string[] {
	const packages = join(agentDirectory, 'packages')
	if (!existsSync(packages)) return []
	return readdirSync(packages, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(packages, entry.name))
}

export function baseRoots(agentDirectory: string): string[] {
	return [agentDirectory, ...packageRoots(agentDirectory)]
}

export function installDependencies(roots: string[]): void {
	for (const root of roots.filter((path) => existsSync(join(path, LOCKFILE)))) {
		console.log(`pnpm install in ${root}`)
		execFileSync(
			'pnpm',
			['install', '--frozen-lockfile', '--config.strict-dep-builds=false'],
			{ cwd: root, stdio: 'inherit' },
		)
	}
}
