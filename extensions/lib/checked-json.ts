import { Value } from 'typebox/value'

import { parseJson } from './parse-json.ts'

import type { Static, TSchema } from 'typebox'

export function readCheckedJson<Schema extends TSchema>(
	path: string,
	schema: Schema,
): Static<Schema> {
	const candidate = parseJson(path)
	if (Value.Check(schema, candidate)) return candidate
	const violations = [...Value.Errors(schema, candidate)]
		.map(error => `${error.instancePath || '/'} ${error.message}`)
		.join('; ')
	throw new Error(`invalid ${path}: ${violations}`)
}
