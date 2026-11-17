/**
 * Request/answer contract between the guard's shell job registry (producer,
 * `tools/guard`) and readers of its awaited job count (`ui/herdr-status`):
 * running foreground commands that outlived their window, not background
 * starts such as servers:
 * the reader emits a request whose `result` the producer fills in
 * synchronously over `pi.events`. The request crosses extension boundaries,
 * so its shape is declared once (typebox) and parsed by the producer.
 *
 * A bash result whose details are a job snapshot reports a command a job
 * still owns (promoted, or a job control), not the command's own output.
 */
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Static } from 'typebox'

export const BASH_JOBS_EVENT = 'pi-guard:bash-jobs:v1'
export const BASH_JOBS_VERSION = 1

export const BashJobsPayloadSchema = Type.Object({
	version: Type.Literal(BASH_JOBS_VERSION),
	awaited: Type.Integer({ minimum: 0 }),
})

export type BashJobsPayload = Static<typeof BashJobsPayloadSchema>

export interface BashJobsRequest {
	version: typeof BASH_JOBS_VERSION
	result?: unknown
}

const OpenRequestSchema = Type.Object({
	version: Type.Unknown(),
	result: Type.Optional(Type.Unknown()),
})

export function answerBashJobs(
	rawRequest: unknown,
	awaited: () => number,
): void {
	if (!Value.Check(OpenRequestSchema, rawRequest)) return
	const request = rawRequest
	if (request.result) return
	if (request.version !== BASH_JOBS_VERSION) {
		request.result = {
			error: `Unsupported bash jobs event version '${String(request.version)}'.`,
		}
		return
	}
	const payload: BashJobsPayload = {
		version: BASH_JOBS_VERSION,
		awaited: awaited(),
	}
	request.result = payload
}

export const JobSnapshotSchema = Type.Object({
	jobId: Type.String(),
	command: Type.String(),
	cwd: Type.String(),
	status: Type.Union([
		Type.Literal('running'),
		Type.Literal('stopping'),
		Type.Literal('completed'),
		Type.Literal('failed'),
		Type.Literal('cancelled'),
	]),
	startedAt: Type.Number(),
	finishedAt: Type.Optional(Type.Number()),
	receiptPath: Type.Optional(Type.String()),
	persistenceError: Type.Optional(Type.String()),
	notificationError: Type.Optional(Type.String()),
	fullOutputPath: Type.Optional(Type.String()),
})
export type JobSnapshot = Static<typeof JobSnapshotSchema>

export function isJobReport(details: unknown): boolean {
	return Value.Check(JobSnapshotSchema, details)
}
