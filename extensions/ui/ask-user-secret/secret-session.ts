import type { BrokerDialog } from '#lib/human-dialog/broker.ts'
import type { DialogCompletion } from '#lib/human-dialog/completion.ts'
import type { BrokerReceipt } from '#lib/human-dialog/schema.ts'

export async function secretSession(
	broker: BrokerDialog,
	key: string,
	show: (
		completion: DialogCompletion<string | undefined>,
	) => Promise<string | undefined>,
	signal: AbortSignal | undefined,
): Promise<BrokerReceipt> {
	let receipt = await broker.open(signal)
	if (receipt.result) return receipt
	const watcher = new AbortController()
	const watching = signal
		? AbortSignal.any([watcher.signal, signal])
		: watcher.signal
	const accept = (winner: BrokerReceipt): undefined => {
		if (!winner.result)
			throw new Error(
				'Pots did not confirm the secret write. Open a new request after checking the destination.',
			)
		receipt = winner
		return undefined
	}
	const wait = async (): Promise<undefined> =>
		accept(await broker.wait(watching))
	const waiting = wait()
	void Promise.allSettled([waiting])
	try {
		await show({
			wait: waiting,
			submit: async typed =>
				accept(
					await broker.perform(
						typed ? 'secret' : 'cancel',
						typed ? { [key]: typed } : undefined,
						signal,
					),
				),
		})
		return receipt
	} finally {
		watcher.abort()
	}
}
