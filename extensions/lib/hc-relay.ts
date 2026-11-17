const WRAPPER = /<hc\b[^>]*>(?<body>[\s\S]*?)<\/hc>/u

export function ownTerminal(): string | undefined {
	return process.env.HC_TERMINAL_ID
}

/** `hc send` types `<hc from="t1 name">text</hc>` into the receiver's input, where Pi records it as interactive; it can land behind a leftover draft, so a block anywhere marks a relay. The relayed text, or undefined when none. */
export function readRelay(text: string): string | undefined {
	const wrapped = WRAPPER.exec(text)?.groups
	if (!wrapped) return undefined
	return wrapped.body ?? ''
}
