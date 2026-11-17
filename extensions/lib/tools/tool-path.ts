import { homedir } from 'node:os'
import { resolve } from 'node:path'

/** The absolute path a file tool's `path` argument names: a leading `~` is the home directory, anything else resolves against `cwd`. */
export function resolveToolPath(cwd: string, path: string): string {
	return resolve(
		cwd,
		path.replace(/^~(?=\/|$)/u, () => homedir()),
	)
}
