import { rmSync } from 'node:fs'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Server, Socket } from 'node:net'

const INPUT_LIMIT = 16_384
const INPUT_TIMEOUT_MS = 5000
const DIRECTORY_MODE = 0o700
const SOCKET_MODE = 0o600

export class PrivateSecretServer {
	readonly socket: string
	private readonly connections = new Set<Socket>()
	private server: Server | undefined
	private isClosed = false
	private readonly onExit = (): void =>
		rmSync(this.directory, { recursive: true, force: true })

	private constructor(
		private readonly directory: string,
		private readonly accept: (candidate: unknown) => object,
	) {
		this.socket = join(directory, 'secret.sock')
	}

	static async open(
		accept: (candidate: unknown) => object,
	): Promise<PrivateSecretServer> {
		const directory = await mkdtemp(join(tmpdir(), 'pi-human-'))
		const endpoint = new PrivateSecretServer(directory, accept)
		try {
			await chmod(directory, DIRECTORY_MODE)
			await endpoint.listen()
			await chmod(endpoint.socket, SOCKET_MODE)
			process.once('exit', endpoint.onExit)
			return endpoint
		} catch {
			await endpoint.close()
			throw new Error(
				'The private browser-secret socket could not start.',
			)
		}
	}

	async close(): Promise<void> {
		if (this.isClosed) return
		this.isClosed = true
		process.off('exit', this.onExit)
		for (const connection of this.connections) connection.destroy()
		if (this.server)
			await new Promise<void>(resolve =>
				this.server?.close(() => resolve()),
			)
		await rm(this.directory, { recursive: true, force: true })
	}

	private listen(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = createServer(connection => this.connected(connection))
			this.server.on('error', () =>
				reject(new Error('Private secret socket failed.')),
			)
			this.server.listen(this.socket, resolve)
		})
	}

	private connected(connection: Socket): void {
		this.connections.add(connection)
		connection.setTimeout(INPUT_TIMEOUT_MS, () => connection.destroy())
		connection.on('error', () => connection.destroy())
		connection.on('close', () => this.connections.delete(connection))
		let packet = Buffer.alloc(0)
		let isHandled = false
		connection.on('data', (chunk: Buffer) => {
			if (isHandled || packet.length + chunk.length > INPUT_LIMIT) {
				connection.destroy()
				return
			}
			packet = Buffer.concat([packet, chunk])
			if (!packet.includes('\n')) return
			isHandled = true
			this.reply(connection, packet)
			packet = Buffer.alloc(0)
		})
		connection.on('end', () => {
			if (!isHandled) connection.destroy()
		})
	}

	private reply(connection: Socket, packet: Buffer): void {
		try {
			const candidate: unknown = JSON.parse(packet.toString('utf8'))
			connection.end(`${JSON.stringify(this.accept(candidate))}\n`)
		} catch {
			connection.destroy()
		}
	}
}
