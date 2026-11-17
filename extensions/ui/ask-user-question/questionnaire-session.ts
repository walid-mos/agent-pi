import { parseAskResult } from './questionnaire-normalization.ts'
import { questionnaireKey } from './questionnaire-output.ts'

import type { QuestionnaireInitialState } from './questionnaire-model.ts'

type DraftEntry = {
	type: string
	message?: {
		role: string
		toolName?: string
		isError?: boolean
		details?: unknown
	}
}

export function restoreQuestionnaireDrafts(
	entries: readonly DraftEntry[],
): Map<string, QuestionnaireInitialState> {
	const drafts = new Map<string, QuestionnaireInitialState>()
	for (const entry of entries) {
		if (
			entry.type !== 'message' ||
			!entry.message ||
			entry.message.role !== 'toolResult' ||
			entry.message.toolName !== 'ask_user_question' ||
			entry.message.isError
		)
			continue
		const outcome = parseAskResult(entry.message.details)
		if (!outcome) continue
		const key = questionnaireKey(outcome.questions)
		if (outcome.chat) drafts.set(key, outcome.chat.initialState)
		else drafts.delete(key)
	}
	return drafts
}
