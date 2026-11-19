import { Marked } from '@earendil-works/pi-tui'

import type {
	MarkdownTransformContext,
	MarkdownTransformer,
} from '@earendil-works/pi-coding-agent'
import type { Token } from '@earendil-works/pi-tui'

const markdownParser = new Marked()
const HORIZONTAL_HEADER =
	/^([ \t]{0,3}(?:`{3,}|~{3,})[^\n]*\n(?:[ \t]*(?:%%[^\n]*)?\n)*[ \t]*(?:flowchart|graph)[ \t]+)(LR|RL)(?=[ \t;\n]|$)/i

function isMermaid(token: Token): boolean {
	return (
		token.type === 'code' &&
		token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() === 'mermaid'
	)
}

function hasDiagram(markdown: string): boolean {
	return (
		markdown.trim() !== '' &&
		!markdownParser.lexer(markdown).some(isMermaid)
	)
}

function retryMermaid(
	fence: string,
	context: MarkdownTransformContext,
	render: MarkdownTransformer,
): string {
	if (context.isStreaming) return '\n\n> Mermaid diagram rendering…\n\n'
	const vertical = fence.replace(
		HORIZONTAL_HEADER,
		(_match, header: string, direction: string) =>
			`${header}${direction.toUpperCase() === 'RL' ? 'BT' : 'TB'}`,
	)
	if (vertical !== fence) {
		const diagram = render(vertical, context)
		if (hasDiagram(diagram)) return `\n\n${diagram.trimEnd()}\n\n`
	}
	const fullWidth = render(fence, { ...context, availableWidth: Infinity })
	const caption = hasDiagram(fullWidth)
		? `Mermaid source (diagram exceeds ${context.availableWidth} columns).`
		: 'Mermaid source.'
	return `\n\n> ${caption}\n\n${fence}`
}

export function replaceUnrenderedMermaid(
	markdown: string,
	context: MarkdownTransformContext,
	render: MarkdownTransformer,
): string {
	if (context.messageType !== 'assistant' || !/mermaid/i.test(markdown))
		return markdown
	const tokens = markdownParser.lexer(markdown)
	if (!tokens.some(isMermaid)) return markdown
	return tokens
		.map(token =>
			isMermaid(token)
				? retryMermaid(token.raw, context, render)
				: token.raw,
		)
		.join('')
}
