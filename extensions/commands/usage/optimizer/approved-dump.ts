import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import { timestampOf } from './closed-utc-day.ts'
import { parseDumpEvidence } from './dump-evidence.ts'

import type { DumpEvidence } from './dump-evidence.ts'

const MAX_DUMP_BYTES = 16_777_216

export type Permit = {
	id: string
	host: string
	source: string
	file: string
	operation: string
	expiresAt: string
}

type Scope = Pick<Permit, 'host' | 'source' | 'file' | 'operation'>

type ApprovedRead = {
	permitId: string
	status: 'approved'
	evidence: DumpEvidence
}
type DeniedRead = {
	permitId: string
	status: 'denied'
	reason:
		| 'permit_scope_mismatch'
		| 'permit_expired'
		| 'permit_denied'
		| 'file_refused'
}

export async function readApprovedDump(input: {
	permit: Permit
	consumePermit: (permit: Permit) => Promise<boolean>
	expected: Scope
	filePath: string
	now: string
	day: string
}): Promise<ApprovedRead | DeniedRead> {
	if (
		!sameScope(input.permit, input.expected) ||
		input.expected.file !== input.filePath ||
		!isAbsolute(input.filePath)
	)
		return {
			permitId: input.permit.id,
			status: 'denied',
			reason: 'permit_scope_mismatch',
		}
	if (!isCurrent(input.permit.expiresAt, input.now))
		return {
			permitId: input.permit.id,
			status: 'denied',
			reason: 'permit_expired',
		}
	if (!(await input.consumePermit(input.permit)))
		return {
			permitId: input.permit.id,
			status: 'denied',
			reason: 'permit_denied',
		}
	try {
		const contents = await readLiteralFile(input.filePath)
		return {
			permitId: input.permit.id,
			status: 'approved',
			evidence: parseDumpEvidence(contents, input.day),
		}
	} catch {
		return {
			permitId: input.permit.id,
			status: 'denied',
			reason: 'file_refused',
		}
	}
}

async function readLiteralFile(path: string): Promise<unknown> {
	if ((await realpath(path)) !== path)
		throw new Error('Expected a canonical file path')
	const file = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	)
	try {
		const before = await file.stat()
		if (
			!before.isFile() ||
			before.size > MAX_DUMP_BYTES ||
			before.nlink !== 1
		)
			throw new Error('Expected one bounded regular file')
		const buffer = Buffer.alloc(before.size + 1)
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
		const after = await file.stat()
		if (
			bytesRead !== before.size ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs
		)
			throw new Error('Pi dump changed while being read')
		return JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(
				buffer.subarray(0, bytesRead),
			),
		)
	} finally {
		await file.close()
	}
}

function sameScope(permit: Permit, expected: Scope): boolean {
	return (
		Boolean(permit.id && permit.host) &&
		permit.host === expected.host &&
		permit.source === 'pi-dump' &&
		permit.source === expected.source &&
		permit.file === expected.file &&
		permit.operation === 'read' &&
		expected.operation === 'read'
	)
}

function isCurrent(expiry: string, now: string): boolean {
	try {
		return timestampOf(now) < timestampOf(expiry)
	} catch {
		return false
	}
}
