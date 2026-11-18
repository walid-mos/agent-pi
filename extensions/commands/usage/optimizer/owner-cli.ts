import { lstatSync } from 'node:fs'
import { mkdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
	latestClosedUtcDay,
	parisSlotState,
	timestampOf,
} from './closed-utc-day.ts'
import { localReportPath, writeLocalReport } from './local-report.ts'
import { nativeClaude } from './native-claude.ts'
import { runNightly } from './nightly.ts'
import {
	loadOwnerDecoder,
	readOwnerConfig,
	readOwnerHandoff,
} from './owner-input.ts'
import { recordPrintAttempt } from './print-attempt.ts'
import { NATIVE_MODEL_ID } from './proposal.ts'

const USAGE =
	'Usage: node owner-cli.ts ABSOLUTE_OWNER_CONFIG INTENDED_PARIS_SLOT_ISO'
const CLI_ARGUMENT_START = 2
const PRIVATE_DIRECTORY_MODE = 0o700

async function runOwnerNightly(
	configPath: string,
	intendedSlot: string,
): Promise<string> {
	const actualInvocation = new Date().toISOString()
	parisSlotState(intendedSlot)
	if (timestampOf(actualInvocation) < timestampOf(intendedSlot))
		throw new Error(
			'Actual invocation must be at or after the intended slot',
		)
	const day = latestClosedUtcDay(intendedSlot)
	const config = await readOwnerConfig(configPath)
	const { reportDirectory } = config
	const completePath = localReportPath(reportDirectory, day, 'complete')
	const lock = `${completePath}.lock`
	const attemptPath = join(reportDirectory, `${day}.attempt.json`)
	await mkdir(lock, { mode: PRIVATE_DIRECTORY_MODE })
	try {
		if (reportExists(completePath)) return `Already complete for ${day}`
		if (lstatSync(attemptPath, { throwIfNoEntry: false }))
			throw new Error(
				`Claude print attempt for ${day} requires owner recovery; see ${attemptPath}`,
			)
		const report = await runNightly({
			intendedSlot,
			actualInvocation,
			hosts: await readOwnerHandoff(config, day),
			contract: await loadOwnerDecoder(config),
			selection: { selector: NATIVE_MODEL_ID, isVerified: true },
			modelAdapter: nativeClaude(config.nativeClaude, lock, () =>
				recordPrintAttempt(attemptPath, { day, intendedSlot }),
			),
		})
		const path = localReportPath(reportDirectory, day, report.status)
		if (report.status === 'complete' || !reportExists(path))
			await writeLocalReport(reportDirectory, report)
		return `${report.status} report for ${day}`
	} finally {
		await rmdir(lock)
	}
}

function reportExists(path: string): boolean {
	const status = lstatSync(path, { throwIfNoEntry: false })
	if (!status) return false
	if (!status.isFile())
		throw new Error('Expected a regular report file in the owner directory')
	return true
}

async function main(args: string[]): Promise<void> {
	const [configPath, intendedSlot, ...extra] = args
	if (configPath === '--help' && !intendedSlot) {
		process.stdout.write(`${USAGE}\n`)
		return
	}
	if (!configPath || !intendedSlot || extra.length) throw new Error(USAGE)
	process.stdout.write(`${await runOwnerNightly(configPath, intendedSlot)}\n`)
}

try {
	await main(process.argv.slice(CLI_ARGUMENT_START))
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : 'Nightly optimizer failed'}\n`,
	)
	process.exitCode = 1
}
