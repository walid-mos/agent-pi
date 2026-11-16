import { renameSync, rmSync, writeFileSync } from 'node:fs'

export function writeAtomically(path: string, text: string, mode?: number): void {
	const pending = `${path}.${process.pid}.tmp`
	try {
		writeFileSync(pending, text, { mode, flag: 'wx' })
		renameSync(pending, path)
	} finally {
		rmSync(pending, { force: true })
	}
}
