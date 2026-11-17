import { Type } from 'typebox'

import type { Static } from 'typebox'

export const BrokerPolicySchema = Type.Enum(['ordinary', 'push', 'local'], {
	type: 'string',
	description:
		'Use push only for an explicit one-push approval, with exact scope. Ordinary is the default. Local stays in the terminal.',
})
const Text = Type.String({ minLength: 1 })
const SNOWFLAKE = '\\d{17,20}'
const Snowflake = Type.String({ pattern: `^${SNOWFLAKE}$` })
export const BrokerAnswerSchema = Type.Object(
	{
		id: Text,
		labels: Type.Array(Text),
		text: Type.String(),
	},
	{ additionalProperties: false },
)
const ClickSchema = Type.Object(
	{
		question: Text,
		userId: Snowflake,
		guildId: Snowflake,
		messageUrl: Type.String({
			pattern: `^https://discord\\.com/channels/${SNOWFLAKE}/${SNOWFLAKE}/${SNOWFLAKE}$`,
		}),
		at: Text,
	},
	{ additionalProperties: false },
)
export const BrokerResultSchema = Type.Union([
	Type.Object(
		{
			status: Type.Literal('answered'),
			origin: Type.Union([
				Type.Literal('terminal'),
				Type.Literal('discord'),
			]),
			answers: Type.Array(BrokerAnswerSchema),
			dialog: Text,
			request: Type.Optional(Text),
			digest: Text,
			scope: Type.Optional(Text),
			at: Type.Number(),
			evidence: Type.Optional(
				Type.Object(
					{ clicks: Type.Array(ClickSchema) },
					{ additionalProperties: false },
				),
			),
			messageId: Type.Optional(Text),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			status: Type.Union([
				Type.Literal('cancelled'),
				Type.Literal('paused'),
				Type.Literal('expired'),
			]),
			origin: Type.Union([
				Type.Literal('terminal'),
				Type.Literal('page'),
			]),
			at: Type.Number(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			status: Type.Literal('stored'),
			origin: Type.Union([
				Type.Literal('terminal'),
				Type.Literal('page'),
			]),
			at: Type.Number(),
			dialog: Text,
			request: Type.Optional(Text),
			target: Type.Optional(
				Type.Object(
					{ destination: Type.Literal('browser'), origin: Text },
					{ additionalProperties: false },
				),
			),
			handoff: Type.Optional(Type.String({ pattern: '^[a-f0-9]{32}$' })),
		},
		{ additionalProperties: false },
	),
])

export const BrokerReceiptSchema = Type.Object({
	id: Text,
	kind: Type.Union([Type.Literal('question'), Type.Literal('secret')]),
	policy: BrokerPolicySchema,
	result: Type.Optional(BrokerResultSchema),
	delivery: Type.Optional(Type.Object({ id: Text })),
})

export type BrokerAnswer = Static<typeof BrokerAnswerSchema>
export type BrokerResult = Static<typeof BrokerResultSchema>
export type BrokerReceipt = Static<typeof BrokerReceiptSchema>
export const BrokerSourceSchema = Type.Object(
	{
		type: Type.Literal('worker'),
		worker: Type.String(),
		session: Type.String(),
		call: Type.String(),
	},
	{ additionalProperties: false },
)
export type BrokerSource = Static<typeof BrokerSourceSchema>
export type BrokerQuestion = {
	id: string
	prompt: string
	multiple: boolean
	options: { label: string; detail: string; recommended: boolean }[]
}
type BrokerBrowserTarget = {
	destination: 'browser'
	origin: string
	socket: string
	capability: string
}
export type BrokerTarget =
	| BrokerBrowserTarget
	| {
			destination: 'infisical'
			projectId: string
			environment: string
			path: string
			name: string
			replace: boolean
	  }
export type QuestionDialog = {
	kind: 'question'
	policy: Static<typeof BrokerPolicySchema>
	context: string
	scope?: string
	questions: BrokerQuestion[]
}
export type SecretDialog = {
	kind: 'secret'
	purpose: string
	target: BrokerTarget
}
export type UnboundRequest = QuestionDialog | SecretDialog
export type BrokerRequest = { source: BrokerSource } & UnboundRequest
