import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Static } from 'typebox'

const responseSchema = Type.Object(
	{
		metadata: Type.Object(
			{ model: Type.String({ minLength: 1 }) },
			{ additionalProperties: false },
		),
		proposal: Type.Object(
			{
				title: Type.String({ minLength: 1 }),
				sourceFacts: Type.Array(Type.String({ minLength: 1 }), {
					minItems: 1,
				}),
				change: Type.String({ minLength: 1 }),
				measure: Type.String({ minLength: 1 }),
				limitations: Type.Array(Type.String({ minLength: 1 })),
			},
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
)

export type Proposal = Static<typeof responseSchema>['proposal']

export function validateModelResponse(
	candidate: unknown,
	expectedModel: string,
): Proposal {
	if (!Value.Check(responseSchema, candidate))
		throw new Error(
			'Expected structured model response with exact proposal fields',
		)
	if (candidate.metadata.model !== expectedModel)
		throw new Error(
			'Structured response model does not match configured model',
		)
	return candidate.proposal
}
