const UTC_DAY_LENGTH = 10
const HOUR_MS = 3_600_000
const SCHEDULE_HOUR = '02'
const GAP_RECOVERY_HOUR = '03'
const OFFSET_TIMESTAMP =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const parisClock = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Paris',
	hourCycle: 'h23',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
})

export type ParisSlotState =
	| 'regular'
	| 'spring-gap-recovery'
	| 'autumn-fold-first'
	| 'autumn-fold-second'

export function timestampOf(timestamp: string): number {
	const instant = Date.parse(timestamp)
	if (!OFFSET_TIMESTAMP.test(timestamp) || !Number.isFinite(instant))
		throw new Error('Expected an ISO timestamp with an explicit UTC offset')
	return instant
}

export function latestClosedUtcDay(invokedAt: string): string {
	const currentUtcDate = new Date(timestampOf(invokedAt))
	currentUtcDate.setUTCDate(currentUtcDate.getUTCDate() - 1)
	return currentUtcDate.toISOString().slice(0, UTC_DAY_LENGTH)
}

export function parisSlotState(invokedAt: string): ParisSlotState {
	const instant = timestampOf(invokedAt)
	const localTime = parisClock.format(instant)
	const previousHour = parisClock.format(instant - HOUR_MS)
	const nextHour = parisClock.format(instant + HOUR_MS)
	const scheduled = `${SCHEDULE_HOUR}:00:00`
	if (localTime === scheduled) {
		if (nextHour === scheduled) return 'autumn-fold-first'
		if (previousHour === scheduled) return 'autumn-fold-second'
		return 'regular'
	}
	if (
		localTime === `${GAP_RECOVERY_HOUR}:00:00` &&
		previousHour === '01:00:00'
	)
		return 'spring-gap-recovery'
	throw new Error('Expected a 02:00 Europe/Paris slot or its DST recovery')
}
