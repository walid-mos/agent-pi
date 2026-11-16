import { readFileSync } from 'node:fs'

export function parseJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, 'utf8'))
	} catch (error) {
		if (error instanceof SyntaxError)
			throw new Error(`invalid ${path}: ${error.message}`, {
				cause: error,
			})
		throw error
	}
}
