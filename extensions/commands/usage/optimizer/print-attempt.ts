import { open } from 'node:fs/promises'
import { dirname } from 'node:path'

const PRIVATE_FILE_MODE = 0o600

type Attempt = {
	day: string
	intendedSlot: string
}

export async function recordPrintAttempt(
	path: string,
	attempt: Attempt,
): Promise<void> {
	const marker = await open(path, 'wx', PRIVATE_FILE_MODE)
	try {
		await marker.writeFile(
			`${JSON.stringify({
				...attempt,
				recordedAt: new Date().toISOString(),
				launcherPid: process.pid,
			})}\n`,
		)
		await marker.sync()
	} finally {
		await marker.close()
	}
	const directory = await open(dirname(path), 'r')
	try {
		await directory.sync()
	} finally {
		await directory.close()
	}
}
