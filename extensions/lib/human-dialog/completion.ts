export type DialogCompletion<T> = {
	submit(outcome: T): Promise<T>
	wait: Promise<T>
}

export type DialogOutcome<T> =
	| { ok: true; value: T }
	| { ok: false; error: unknown }

export function bindCompletion<T>(
	completion: DialogCompletion<T> | undefined,
	done: (outcome: DialogOutcome<T>) => void,
): (outcome: T) => void {
	let isFinished = false
	let isSubmitting = false
	const finish = (outcome: DialogOutcome<T>): void => {
		if (isFinished) return
		isFinished = true
		done(outcome)
	}
	const settle = async (pending: Promise<T>): Promise<void> => {
		try {
			finish({ ok: true, value: await pending })
		} catch (error) {
			finish({ ok: false, error })
		}
	}
	if (completion) void settle(completion.wait)
	return outcome => {
		if (isFinished || isSubmitting) return
		isSubmitting = true
		if (!completion) return finish({ ok: true, value: outcome })
		void settle(completion.submit(outcome))
	}
}
