/** A message or tool-result content part; only text parts carry `text`. */
type ContentPart = { readonly type: string; readonly text?: string }

/** The text parts of a content list, in order, joined; images, thinking and tool calls are dropped. */
export function contentText(
	content: readonly ContentPart[],
	separator = '\n',
): string {
	return content
		.flatMap(part =>
			part.type === 'text' && typeof part.text === 'string'
				? [part.text]
				: [],
		)
		.join(separator)
}
