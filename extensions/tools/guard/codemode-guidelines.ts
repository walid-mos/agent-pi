/** Guidelines re-sent under the codemode tool at every prompt: pi's description names `@options`
 * but not the default cap, and says a call rejects on failure but not what that does to a batch. */
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
} from '@earendil-works/pi-coding-agent'

import { VALIDATION_RUNNERS, VALIDATION_TASKS } from './shell-segments.ts'

/** pi's documented default for `max_output_tokens` (docs/codemode.md); restated so the model can size a budget. */
const DEFAULT_OUTPUT_TOKENS = 10_000
const INLINE_BODY_CAP = '2 KB'

const CODEMODE_GUIDELINES: readonly string[] = [
	`A codemode script returns at most ${String(DEFAULT_OUTPUT_TOKENS)} tokens of output by default (start and end kept, the middle only in a temp file): when batched reads may exceed it, set \`// @options: {"max_output_tokens": <n>}\` on the first line, or print only the extract you need.`,
	'A failing call rejects and ends the script; its earlier calls are not undone. Wrap each mutating call in try/catch (independent calls: Promise.allSettled) and print one status line per call, so one bad edit does not discard the batch.',
	`Never run a validation (${VALIDATION_RUNNERS.join('/')} with a ${VALIDATION_TASKS.join(', ')} task) inside a script: a non-zero exit rejects it, and the guard refuses the call. Finish the batch, then run the validation as a direct bash call without redirecting its output; the guard saves its complete log.`,
	`tools.read caps a file at ${String(DEFAULT_MAX_LINES)} lines or ${formatSize(DEFAULT_MAX_BYTES)}, so JSON.parse of a read result fails on a larger file: extract fields with jq through bash, or read in offset chunks.`,
	`Embed file contents only in template literals with every backtick and \${ escaped; a body over about ${INLINE_BODY_CAP} goes through a direct write call instead.`,
]

interface GuidelineOptions {
	selectedTools: string[]
	toolGuidelines: Record<string, string[]>
}

/** Append the guidelines under the codemode tool, once each, only while codemode is selected. */
export function addCodemodeGuidelines(options: GuidelineOptions): void {
	if (!options.selectedTools.includes('codemode')) return
	// oxlint-disable-next-line eslint/no-param-reassign - pi documents systemPromptOptions as mutable; later handlers observe the change
	const guidelines = (options.toolGuidelines.codemode ??= [])
	for (const guideline of CODEMODE_GUIDELINES)
		if (!guidelines.includes(guideline)) guidelines.push(guideline)
}
