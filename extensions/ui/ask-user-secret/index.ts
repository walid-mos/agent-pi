/**
 * ask_user_secret: the one way a secret typed by the human reaches a tool.
 * The dialog (secret-dialog.ts) masks the entry; the value then either parks
 * in the in-process handoff (secret-store.ts) under a one-time, origin-bound
 * handle that frontend_batch claims, or goes to Infisical through the house
 * script (infisical-write.ts). schema.ts owns the boundary shapes,
 * request.ts validates the destination, transcript.ts renders the cards. The
 * model and the transcript only ever see handles, key names and statuses.
 */
import { Text } from '@earendil-works/pi-tui'

import { contentText } from '#lib/content-text.ts'
import { configuredBroker } from '#lib/human-dialog/config.ts'
import { TranscriptComponent } from '#lib/ui/transcript-component.ts'

import { brokerSecret } from './broker-secret.ts'
import { writeSecret } from './infisical-write.ts'
import { describeRequest, parseRequest } from './request.ts'
import { SecretParams } from './schema.ts'
import { showSecretDialog } from './secret-dialog.ts'
import { secretHandoff } from './secret-store.ts'
import {
	parseSecretResult,
	renderCallLines,
	renderResultLines,
} from './transcript.ts'

import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { BrokerFactory } from '#lib/human-dialog/config.ts'
import type { SecretRequest } from './request.ts'
import type { SecretParamsType, SecretResult } from './schema.ts'

interface RowState {
	answered?: boolean
}

const MS_PER_SECOND = 1000

const TOOL_DESCRIPTION =
	'Ask the human for a secret (password, token, one-time code, API key) through a masked local dialog that never echoes, logs or returns the value. Use it whenever a flow needs a value the human holds; never ask for a secret in chat and never accept one typed there. destination=browser parks the value under a one-time handle bound to the exact origin you pass (the current page origin, scheme://host[:port]); pass that handle as `secret` on a frontend_batch type step within 3 minutes, and only that origin can consume it. destination=infisical writes the value to the given project/environment/path/name through the vault script and returns the key name only; an existing name needs replace=true. Describe in purpose what the value unlocks, in product terms, so the human knows what to type. Supports the interactive terminal and, in an explicitly configured pot, its private masked page. If the human cancels, stop that flow and say so.'

export default function askUserSecret(pi: ExtensionAPI): void {
	pi.registerTool<typeof SecretParams, SecretResult, RowState>({
		name: 'ask_user_secret',
		label: 'Ask User Secret',
		description: TOOL_DESCRIPTION,
		parameters: SecretParams,
		executionMode: 'sequential',
		renderShell: 'self',
		execute: (...[call, params, signal, , context]) =>
			runSecretTool(
				params,
				context,
				signal,
				configuredBroker(pi, context, call),
			),
		renderCall(args, _theme, context) {
			return new TranscriptComponent(width =>
				context.state.answered ? [] : renderCallLines(args, width),
			)
		},
		renderResult(toolResult, _options, _theme, context) {
			if (!context.state.answered) {
				// oxlint-disable-next-line eslint/no-param-reassign - Pi owns this mutable cross-slot state channel
				context.state.answered = true
				// Do not reenter Pi's in-flight display update synchronously.
				queueMicrotask(() => context.invalidate())
			}
			const details = parseSecretResult(toolResult.details)
			if (details)
				return new TranscriptComponent(width =>
					renderResultLines(details, width),
				)
			return new Text(contentText(toolResult.content), 0, 0)
		},
	})
}

async function runSecretTool(
	params: SecretParamsType,
	context: ExtensionContext,
	signal: AbortSignal | undefined,
	createBroker: BrokerFactory | undefined,
): Promise<AgentToolResult<SecretResult>> {
	if (context.mode !== 'tui')
		throw new Error('ask_user_secret requires interactive TUI mode')
	const request = parseRequest(params)
	const prompt = {
		kind: params.kind,
		purpose: params.purpose,
		destination: describeRequest(request),
	}
	if (createBroker)
		return settledResult(
			await brokerSecret(
				createBroker,
				{ request, purpose: params.purpose },
				completion =>
					showSecretDialog(context, signal, prompt, completion),
				signal,
			),
		)
	const typedSecret = await showSecretDialog(context, signal, prompt)
	return settledResult(await storeLocalSecret(request, typedSecret, signal))
}

async function storeLocalSecret(
	request: SecretRequest,
	typedSecret: string | undefined,
	signal: AbortSignal | undefined,
): Promise<SecretResult> {
	if (!typedSecret) return { status: 'cancelled' }
	if (request.destination === 'browser') {
		const { handle, expiresAt } = secretHandoff().issue(
			typedSecret,
			request.origin,
		)
		return { status: 'issued', handle, origin: request.origin, expiresAt }
	}
	const stored = await writeSecret(
		request.target,
		request.shouldReplace,
		typedSecret,
		signal,
	)
	return { status: 'stored', ...stored }
}

function settledResult(details: SecretResult): AgentToolResult<SecretResult> {
	return { content: [{ type: 'text', text: resultText(details) }], details }
}

function resultText(details: SecretResult): string {
	switch (details.status) {
		case 'issued': {
			const seconds = Math.round(
				(details.expiresAt - Date.now()) / MS_PER_SECOND,
			)
			return `Secret handle ${details.handle} issued for ${details.origin}; one use, expires in ${seconds} s. Pass it as \`secret\` on a frontend_batch type step targeting the field on that origin.`
		}
		case 'stored':
			return `Secret ${details.operation} in ${details.target}. The value was not printed.`
		case 'cancelled':
			return 'Secret request cancelled. No successful handoff or write was confirmed.'
	}
}
