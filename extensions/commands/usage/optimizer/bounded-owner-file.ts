import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { FileHandle } from 'node:fs/promises'

const missingFile = Type.Object({ code: Type.Literal('ENOENT') })
const MAX_OWNER_JSON_BYTES = 4_194_304

export async function readOwnerJson(
	path: string,
): Promise<{ contents: unknown } | undefined> {
	const bytes = await readBoundedFile(path, MAX_OWNER_JSON_BYTES)
	if (!bytes) return undefined
	try {
		return {
			contents: JSON.parse(
				new TextDecoder('utf-8', { fatal: true }).decode(bytes),
			),
		}
	} catch (error) {
		throw new Error('Invalid owner input JSON', { cause: error })
	}
}

export async function readBoundedFile(
	path: string,
	limit: number,
): Promise<Buffer | undefined> {
	try {
		if ((await realpath(path)) !== resolve(path))
			throw new Error('Expected a canonical owner file')
		const file = await open(
			path,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		)
		try {
			return await readContents(file, limit)
		} finally {
			await file.close()
		}
	} catch (error) {
		if (Value.Check(missingFile, error)) return undefined
		throw new Error('Could not read bounded owner input', { cause: error })
	}
}

async function readContents(file: FileHandle, limit: number): Promise<Buffer> {
	const before = await file.stat()
	if (!before.isFile() || before.size > limit || before.nlink !== 1)
		throw new Error('Expected bounded regular JSON file')
	const bytes = Buffer.alloc(before.size + 1)
	const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
	const after = await file.stat()
	if (
		bytesRead !== before.size ||
		before.mtimeMs !== after.mtimeMs ||
		before.ctimeMs !== after.ctimeMs
	)
		throw new Error('JSON file changed during read')
	return bytes.subarray(0, bytesRead)
}
