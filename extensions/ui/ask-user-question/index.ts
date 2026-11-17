/** Ask-user-question integration: tool registration and chat-pause lifetime.
 * Domain state/input live in questionnaire-*.ts; shared visual policy lives
 * in ui/. Pending and answered slots share one row-local completion flag.
 * Screenshot captures follow the attachments contract: aliases and a
 * thumbnail strip in the dialog, full images on the submitted tool result,
 * tile-sized snapshot records replayed with the answered card. */
import { Text } from '@earendil-works/pi-tui'

import { contentText } from '#lib/content-text.ts'
import {
	configuredBroker,
	registerBrokerFlags,
} from '#lib/human-dialog/config.ts'
import {
	markAnswered,
	TranscriptComponent,
} from '#lib/ui/transcript-component.ts'

import { brokerQuestionnaire } from './broker-questionnaire.ts'
import { QuestionnaireCaptures } from './questionnaire-captures.ts'
import { QUESTIONNAIRE_MODE_EVENT } from './questionnaire-events.ts'
import { parseAskResult } from './questionnaire-normalization.ts'
import {
	chatFollowUp,
	formatAnswerLines,
	questionnaireKey,
} from './questionnaire-output.ts'
import {
	questionnaireBroker,
	requestedQuestions,
} from './questionnaire-request.ts'
import { restoreQuestionnaireDrafts } from './questionnaire-session.ts'
import {
	renderCallLines,
	renderResultLines,
} from './questionnaire-transcript.ts'
import { AskParams } from './schema.ts'
import { showQuestionnaire } from './show-questionnaire.ts'

import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { Static } from 'typebox'
import type { DialogCompletion } from '#lib/human-dialog/completion.ts'
import type { BrokerFactory } from '#lib/human-dialog/config.ts'
import type { PendingRowState } from '#lib/ui/transcript-component.ts'
import type { QuestionnaireMode } from './questionnaire-events.ts'
import type {
	AskResult,
	QuestionnaireInitialState,
} from './questionnaire-model.ts'

interface AskSession {
	resumeStates: Map<string, QuestionnaireInitialState>
	sendFollowUp(message: string): void
	setMode(mode: QuestionnaireMode): void
}

const TOOL_DESCRIPTION =
	'Ask only for a consequential decision that the human must make. Do not ask when context, established conventions, best practice, or a low-risk reversible default can decide; choose the default and continue. Before calling, gather every currently known human-only blocker into one questionnaire instead of asking across successive turns. A task should normally have one questionnaire round; ask later only when new evidence creates a new blocker. Use this tool instead of a plain-text question. Every question needs a short, unique, stable id reused as the answer key. The user can always write their own answer, select an option by number, or select multiple options when multiSelect is true. Mark the best option recommended when you have one. Omit options for a genuinely open-ended question. If the user cancels, report the cancellation. Cancellation grants no consent; proceed only with work already authorized. Write each prompt for a busy reader who did not watch the work: first sentence names the concrete problem in product terms, second names what you will do by default and its consequence; no evidence ids, round numbers or process vocabulary. Never ask a decision that a recorded questionnaire receipt or a recorded human message already settles, including an answer that the matter does not matter: record it and continue.'

export default function askUserQuestion(pi: ExtensionAPI): void {
	registerBrokerFlags(pi)
	const session: AskSession = {
		resumeStates: new Map(),
		sendFollowUp: message =>
			pi.sendUserMessage(message, { deliverAs: 'followUp' }),
		setMode: mode => pi.events.emit(QUESTIONNAIRE_MODE_EVENT, mode),
	}
	pi.on('session_start', (_event, context) => {
		session.resumeStates = restoreQuestionnaireDrafts(
			context.sessionManager.getBranch(),
		)
	})
	pi.on('session_shutdown', () => session.resumeStates.clear())
	pi.registerTool<typeof AskParams, AskResult | undefined, PendingRowState>({
		name: 'ask_user_question',
		label: 'Ask User Question',
		description: TOOL_DESCRIPTION,
		parameters: AskParams,
		executionMode: 'sequential',
		renderShell: 'self',
		// Destructure Pi's callback boundary; no parallel handwritten signature.
		execute: (...[call, params, signal, , context]) =>
			runAskTool(session, params, {
				context,
				signal,
				createBroker: configuredBroker(pi, context, call),
			}),
		renderCall(args, _theme, context) {
			return TranscriptComponent.pending(context.state, width =>
				renderCallLines(args, width),
			)
		},
		renderResult(toolResult, _options, theme, context) {
			markAnswered(context)
			// Replayed details round-trip through the session file and may predate
			// the current schema: parse before rendering, else fall back to text.
			const details = parseAskResult(toolResult.details)
			if (details)
				return new TranscriptComponent(width =>
					renderResultLines(details, width, theme),
				)
			return new Text(contentText(toolResult.content), 0, 0)
		},
	})
}

async function runAskTool(
	session: AskSession,
	params: Static<typeof AskParams>,
	{
		context,
		signal,
		createBroker,
	}: {
		context: ExtensionContext
		signal: AbortSignal | undefined
		createBroker: BrokerFactory | undefined
	},
): Promise<AgentToolResult<AskResult>> {
	if (context.mode !== 'tui')
		throw new Error('ask_user_question requires interactive TUI mode')
	const questions = requestedQuestions(params)
	session.setMode('answering')
	const key = questionnaireKey(questions)
	const captures = new QuestionnaireCaptures(context.cwd)
	try {
		const resumeState = session.resumeStates.get(key)
		if (resumeState?.captures?.length)
			captures.restore(resumeState.captures)
		const show = (
			completion?: DialogCompletion<AskResult>,
		): Promise<AskResult> =>
			showQuestionnaire(context, signal, {
				questions,
				resumeState,
				captures,
				completion,
			})
		const broker = questionnaireBroker(params, questions, createBroker)
		const outcome = broker
			? await brokerQuestionnaire(broker, questions, show, signal)
			: await show()
		if (outcome.chat)
			return pausedResult(session, key, outcome, outcome.chat)
		session.resumeStates.delete(key)
		return completedResult(questions, outcome, captures)
	} finally {
		await captures.dispose()
	}
}

function pausedResult(
	session: AskSession,
	key: string,
	outcome: AskResult,
	chat: NonNullable<AskResult['chat']>,
): AgentToolResult<AskResult> {
	session.resumeStates.set(key, chat.initialState)
	session.setMode('discussing')
	session.sendFollowUp(chatFollowUp(chat.question))
	return {
		content: [{ type: 'text', text: 'Chat paused' }],
		details: outcome,
		terminate: true,
	}
}

function completedResult(
	questions: AskResult['questions'],
	outcome: AskResult,
	captures: QuestionnaireCaptures,
): AgentToolResult<AskResult> {
	const resultImages = captures.modelAttachments(resultAliases(outcome))
	return {
		content: [
			{
				type: 'text',
				text: resultText(
					questions,
					outcome,
					resultDocuments(outcome, captures),
				),
			},
			...resultImages,
		],
		details: outcome,
	}
}

/** Aliases the submitted outcome's snapshot records carry. */
function resultAliases(outcome: AskResult): string[] {
	return (outcome.captures ?? []).map(record => record.alias)
}

/** The Documents line on the submitted answers, absent when cancelled. */
function resultDocuments(
	outcome: AskResult,
	captures: QuestionnaireCaptures,
): string | undefined {
	if (outcome.cancelled) return undefined
	return captures.documentLine(resultAliases(outcome))
}

/** The result text: the answers when submitted, a cancel note otherwise. */
function resultText(
	questions: AskResult['questions'],
	outcome: AskResult,
	documents: string | undefined,
): string {
	if (outcome.cancelled) return 'User cancelled the question'
	return appendDocuments(
		formatAnswerLines(questions, outcome.answers),
		documents,
	)
}

/** Trailing Documents line on a result that referenced PDF captures. */
function appendDocuments(text: string, documents: string | undefined): string {
	return documents ? `${text}\n\n${documents}` : text
}
