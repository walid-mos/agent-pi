import { link, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { stableReportJson } from './proposal.ts'

import type { runNightly } from './nightly.ts'

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const PRIVATE_FILE_MODE = 0o600

type Report = Awaited<ReturnType<typeof runNightly>>

export async function writeLocalReport(
	directory: string,
	report: Report,
): Promise<string> {
	if (!isAbsolute(directory) || !DAY_KEY.test(report.day))
		throw new Error('Expected a local report directory and UTC day key')
	const destination = join(directory, `${report.day}.${report.status}.json`)
	const staging = await mkdtemp(join(directory, '.optimizer-'))
	try {
		const file = join(staging, 'report.json')
		await writeFile(file, stableReportJson(report), {
			mode: PRIVATE_FILE_MODE,
		})
		await link(file, destination)
		return destination
	} finally {
		await rm(staging, { recursive: true, force: true })
	}
}
