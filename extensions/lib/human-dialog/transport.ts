import { spawn } from 'node:child_process'

export type BrokerOperation =
	| 'open'
	| 'get'
	| 'answer'
	| 'secret'
	| 'cancel'
	| 'pause'
export type BrokerTransport = (
	operation: BrokerOperation,
	id?: string,
	input?: unknown,
	signal?: AbortSignal,
) => Promise<unknown>

const COMMAND_TIMEOUT_MS = 10_000
const SECRET_WRITE_TIMEOUT_MS = 130_000
const OUTPUT_LIMIT = 65_536

export function brokerTransport(script: string): BrokerTransport {
	return (operation, id, input, signal) =>
		new Promise((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[script, operation, ...(id ? [id] : [])],
				{
					stdio: ['pipe', 'pipe', 'ignore'],
					signal: AbortSignal.any([
						AbortSignal.timeout(
							operation === 'secret'
								? SECRET_WRITE_TIMEOUT_MS
								: COMMAND_TIMEOUT_MS,
						),
						...(signal ? [signal] : []),
					]),
				},
			)
			let stdout = ''
			let hasFailed = false
			const fail = (): void => {
				hasFailed = true
				reject(
					new Error(
						`Human dialog broker ${operation} failed. Check the installed broker and retry the tool with a new call.`,
					),
				)
			}
			child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
				stdout += chunk
				if (Buffer.byteLength(stdout) <= OUTPUT_LIMIT) return
				stdout = ''
				child.kill()
				fail()
			})
			child.on('error', fail)
			child.on('close', code => {
				if (hasFailed) return
				if (code !== 0) return fail()
				try {
					resolve(JSON.parse(stdout))
				} catch {
					fail()
				}
			})
			child.stdin.on('error', () => undefined)
			child.stdin.end(input ? JSON.stringify(input) : undefined)
		})
}
