const UTC_DAY_LENGTH = 10
const MARCH = 3
const OCTOBER = 10
const HOUR_TWO = 2
const HOUR_THREE = 3
const UTC_MONTH_END = 0

export type ParisSlotState =
	| 'regular'
	| 'spring-gap-recovery'
	| 'autumn-fold-first'
	| 'autumn-fold-second'

export function latestClosedUtcDay(invokedAt: string): string {
	const instant = Date.parse(invokedAt)
	if (!Number.isFinite(instant))
		throw new Error('Expected an ISO timestamp for optimizer invocation')
	const currentUtcDate = new Date(instant)
	currentUtcDate.setUTCDate(currentUtcDate.getUTCDate() - 1)
	return currentUtcDate.toISOString().slice(0, UTC_DAY_LENGTH)
}

export function parisSlotState(invokedAt: string): ParisSlotState {
	const instant = Date.parse(invokedAt)
	if (!Number.isFinite(instant))
		throw new Error('Expected an ISO timestamp for optimizer invocation')
	const local = parisParts(instant)
	const lastSunday = lastSundayOfMonth(local.year, local.month)
	if (
		local.month === MARCH &&
		local.day === lastSunday &&
		local.hour === HOUR_THREE
	)
		return 'spring-gap-recovery'
	if (
		local.month === OCTOBER &&
		local.day === lastSunday &&
		local.hour === HOUR_TWO
	)
		return local.offset === '+02:00'
			? 'autumn-fold-first'
			: 'autumn-fold-second'
	return 'regular'
}

function parisParts(instant: number): {
	year: number
	month: number
	day: number
	hour: number
	offset: string
} {
	const fields = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Paris',
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
	}).formatToParts(instant)
	const values = Object.fromEntries(
		fields.map(part => [part.type, Number(part.value)]),
	)
	const offset = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Europe/Paris',
		timeZoneName: 'longOffset',
	})
		.formatToParts(instant)
		.find(part => part.type === 'timeZoneName')
		?.value.replace('GMT', '')
	const { year, month, day, hour } = values
	if (!year || !month || !day || !hour)
		throw new Error('Unable to read Europe/Paris scheduler fields')
	return {
		year,
		month,
		day,
		hour,
		offset: offset || '+01:00',
	}
}

function lastSundayOfMonth(year: number, month: number): number {
	const lastDay = new Date(Date.UTC(year, month, UTC_MONTH_END))
	return lastDay.getUTCDate() - lastDay.getUTCDay()
}
