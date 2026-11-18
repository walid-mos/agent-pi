import type { NativeSessionEvidence } from './native-session-evidence.ts'

export function sessionEvidenceName(
	scope: Pick<NativeSessionEvidence, 'hostId' | 'source' | 'day'>,
): string {
	return `${scope.hostId}.${scope.day}.${scope.source}.json`
}
