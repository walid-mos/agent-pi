import { readFile } from 'node:fs/promises'

import { parseDumpEvidence } from './dump-evidence.ts'

import type { DumpEvidence } from './dump-evidence.ts'

type Permit = {
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
	reason: 'permit_scope_mismatch' | 'permit_expired'
}

export async function readApprovedDump(input: {
	permit: Permit
	expected: Scope
	filePath: string
	now: string
	day: string
}): Promise<ApprovedRead | DeniedRead> {
	if (
		!sameScope(input.permit, input.expected) ||
		input.expected.file !== input.filePath
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
	const contents: unknown = JSON.parse(await readFile(input.filePath, 'utf8'))
	return {
		permitId: input.permit.id,
		status: 'approved',
		evidence: parseDumpEvidence(contents, input.day),
	}
}

function sameScope(permit: Permit, expected: Scope): boolean {
	return (
		permit.host === expected.host &&
		permit.source === expected.source &&
		permit.file === expected.file &&
		permit.operation === 'read' &&
		expected.operation === 'read'
	)
}

function isCurrent(expiry: string, now: string): boolean {
	const expiryMs = Date.parse(expiry)
	const nowMs = Date.parse(now)
	return (
		Number.isFinite(expiryMs) && Number.isFinite(nowMs) && nowMs < expiryMs
	)
}
