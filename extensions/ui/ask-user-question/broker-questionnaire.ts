import type { BrokerDialog } from '#lib/human-dialog/broker.ts'
import type { DialogCompletion } from '#lib/human-dialog/completion.ts'
import type {
	BrokerAnswer,
	BrokerQuestion,
	BrokerReceipt,
} from '#lib/human-dialog/schema.ts'
import type { Answer, AskResult, Question } from './questionnaire-model.ts'

export function brokerQuestions(questions: Question[]): BrokerQuestion[] {
	return questions.map(question => {
		const labels = question.options.map(option => option.label)
		if (
			new Set(labels).size !== labels.length ||
			labels.some(label => /[\r\n]/.test(label))
		)
			throw new Error(
				'Pots questions require distinct single-line option labels. Keep option values distinct too.',
			)
		return {
			id: question.id,
			prompt: question.prompt,
			multiple: question.multiSelect,
			options: question.options.map(option => ({
				label: option.label,
				detail: option.description ?? '',
				recommended: option.recommended === true,
			})),
		}
	})
}

export async function brokerQuestionnaire(
	broker: BrokerDialog,
	questions: Question[],
	show: (completion: DialogCompletion<AskResult>) => Promise<AskResult>,
	signal: AbortSignal | undefined,
): Promise<AskResult> {
	const opened = await broker.open(signal)
	if (opened.result) return questionnaireReceipt(opened, questions)
	const watcher = new AbortController()
	let local: AskResult | undefined
	const convert = (receipt: BrokerReceipt): AskResult =>
		questionnaireReceipt(receipt, questions, local)
	const wait = async (): Promise<AskResult> =>
		convert(await broker.wait(watcher.signal))
	try {
		return await show({
			wait: wait(),
			submit: async outcome => {
				local = outcome
				const operation = submissionOperation(outcome)
				const input =
					operation === 'answer'
						? {
								answers: terminalAnswers(
									questions,
									outcome.answers,
								),
							}
						: undefined
				return convert(await broker.perform(operation, input))
			},
		})
	} finally {
		watcher.abort()
		if (signal?.aborted) await broker.perform('cancel')
	}
}

function submissionOperation(
	outcome: AskResult,
): 'pause' | 'cancel' | 'answer' {
	if (outcome.chat) return 'pause'
	return outcome.cancelled ? 'cancel' : 'answer'
}

function terminalAnswers(
	questions: Question[],
	answers: Answer[],
): BrokerAnswer[] {
	return questions.map(question => {
		const answer = answers.find(candidate => candidate.id === question.id)
		if (!answer)
			throw new Error('Answer every question before submitting to Pots.')
		if (answer.kind === 'single')
			return {
				id: answer.id,
				labels: answer.wasCustom ? [] : [answer.label],
				text: answer.wasCustom ? answer.value : '',
			}
		return {
			id: answer.id,
			labels: answer.optionValues.map(optionValue => {
				const option = question.options.find(
					candidate => candidate.value === optionValue,
				)
				if (!option)
					throw new Error(
						'Terminal answer contains an unknown option value.',
					)
				return option.label
			}),
			text: answer.customText ?? '',
		}
	})
}

function questionnaireReceipt(
	receipt: BrokerReceipt,
	questions: Question[],
	local?: AskResult,
): AskResult {
	const { result: outcome } = receipt
	if (!outcome)
		throw new Error(
			'Pots did not settle the question. Retry with a new tool call.',
		)
	if (outcome.status === 'paused' && local?.chat)
		return { ...local, broker: receipt }
	if (outcome.status !== 'answered')
		return { questions, answers: [], cancelled: true, broker: receipt }
	const answers = questions.map(question => {
		const answer = outcome.answers.find(
			candidate => candidate.id === question.id,
		)
		if (!answer)
			throw new Error('Pots omitted a question from its answer receipt.')
		return piAnswer(question, answer)
	})
	const accepted: AskResult = {
		questions,
		answers,
		cancelled: false,
		broker: receipt,
	}
	if (outcome.origin === 'terminal' && local?.captures)
		accepted.captures = local.captures
	return accepted
}

function piAnswer(question: Question, answer: BrokerAnswer): Answer {
	const options = answer.labels.map(label => {
		const option = question.options.find(
			candidate => candidate.label === label,
		)
		if (!option) throw new Error('Pots returned an unknown option label.')
		return option
	})
	const labels = [...answer.labels, ...(answer.text ? [answer.text] : [])]
	const values = [
		...options.map(option => option.value),
		...(answer.text ? [answer.text] : []),
	]
	if (question.multiSelect) {
		const multi: Answer = {
			kind: 'multi',
			id: question.id,
			label: labels.join(', '),
			value: values.join(','),
			wasCustom: !options.length,
			labels,
			optionValues: options.map(option => option.value),
		}
		if (answer.text) multi.customText = answer.text
		return multi
	}
	const [option] = options
	const single: Answer = {
		kind: 'single',
		id: question.id,
		label: option?.label ?? answer.text,
		value: option?.value ?? answer.text,
		wasCustom: !option,
	}
	if (option) single.index = question.options.indexOf(option) + 1
	return single
}
