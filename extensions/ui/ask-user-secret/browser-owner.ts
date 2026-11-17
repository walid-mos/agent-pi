import { randomBytes, timingSafeEqual } from 'node:crypto'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { BrokerSourceSchema } from '#lib/human-dialog/schema.ts'

import { PrivateSecretServer } from './private-secret-server.ts'
import { MAX_SECRET_LENGTH, SecretValueSchema } from './schema.ts'
import { secretHandoff } from './secret-store.ts'

import type { BrokerSource } from '#lib/human-dialog/schema.ts'

const CAPABILITY_BYTES = 32
const HANDOFF_BYTES = 16
const OWNER_TIMEOUT_MS = 300_000
const RECEIPT_TIMEOUT_MS = 10_000
const Incoming = Type.Object(
	{
		version: Type.Literal(1),
		dialog: Type.String(),
		source: BrokerSourceSchema,
		origin: Type.String(),
		capability: Type.String(),
		value: SecretValueSchema,
	},
	{ additionalProperties: false },
)

type Parked = { handle: string; expiresAt: number; handoff: string }
type Binding = { dialog: string; source: BrokerSource; origin: string }

export class BrowserSecretOwner {
	readonly capability = randomBytes(CAPABILITY_BYTES).toString('base64url')
	private parked: Parked | undefined
	private isClosed = false
	private isConfirmed = false
	private endpoint: PrivateSecretServer | undefined
	private readonly lifetime = new AbortController()
	private readonly ownerTimer = setTimeout(
		() => this.expire(),
		OWNER_TIMEOUT_MS,
	)
	private receiptTimer: NodeJS.Timeout | undefined

	private constructor(private readonly binding: Binding) {}

	static async open(binding: Binding): Promise<BrowserSecretOwner> {
		const owner = new BrowserSecretOwner(binding)
		try {
			const largestFrame = JSON.stringify({
				version: 1,
				...binding,
				capability: owner.capability,
				value: '\u0001'.repeat(MAX_SECRET_LENGTH),
			})
			const inputLimit = Buffer.byteLength(`${largestFrame}\n`)
			owner.endpoint = await PrivateSecretServer.open(
				inputLimit,
				candidate => owner.accept(candidate),
			)
			return owner
		} catch (error) {
			await owner.dispose()
			throw error
		}
	}

	get socket(): string {
		if (!this.endpoint)
			throw new Error('Browser secret owner has no listening socket.')
		return this.endpoint.socket
	}

	get signal(): AbortSignal {
		return this.lifetime.signal
	}

	confirm(receipt: {
		dialog: string
		origin: string
		handoff: string | undefined
	}): {
		handle: string
		expiresAt: number
	} {
		const { parked } = this
		if (
			this.isConfirmed ||
			this.signal.aborted ||
			!parked ||
			parked.expiresAt <= Date.now() ||
			receipt.dialog !== this.binding.dialog ||
			receipt.origin !== this.binding.origin ||
			receipt.handoff !== parked.handoff
		)
			throw new Error(
				'Browser secret completion has no matching live in-process handoff. Open a new tool call.',
			)
		this.isConfirmed = true
		clearTimeout(this.ownerTimer)
		clearTimeout(this.receiptTimer)
		return { handle: parked.handle, expiresAt: parked.expiresAt }
	}

	async dispose(): Promise<void> {
		if (this.isClosed) return
		this.isClosed = true
		clearTimeout(this.ownerTimer)
		clearTimeout(this.receiptTimer)
		this.lifetime.abort()
		if (this.parked && !this.isConfirmed)
			secretHandoff().claim(this.parked.handle, this.binding.origin)
		this.parked = undefined
		await this.endpoint?.close()
	}

	private expire(): void {
		this.lifetime.abort(
			new Error(
				'Browser secret handoff expired without matching broker confirmation. Open a new tool call.',
			),
		)
	}

	private accept(
		candidate: unknown,
	): Binding & { version: 1; handoff: string } {
		if (
			this.signal.aborted ||
			this.parked ||
			!Value.Check(Incoming, candidate)
		)
			throw new Error('Invalid private secret handoff.')
		const incomingCapability = Buffer.from(candidate.capability)
		const expectedCapability = Buffer.from(this.capability)
		if (
			incomingCapability.length !== expectedCapability.length ||
			!timingSafeEqual(incomingCapability, expectedCapability) ||
			candidate.dialog !== this.binding.dialog ||
			candidate.origin !== this.binding.origin ||
			!Value.Equal(candidate.source, this.binding.source)
		)
			throw new Error(
				'Private secret handoff does not match its waiting tool call.',
			)
		const handoff = randomBytes(HANDOFF_BYTES).toString('hex')
		this.parked = {
			...secretHandoff().issue(candidate.value, this.binding.origin),
			handoff,
		}
		this.receiptTimer = setTimeout(() => this.expire(), RECEIPT_TIMEOUT_MS)
		return { version: 1, ...this.binding, handoff }
	}
}
