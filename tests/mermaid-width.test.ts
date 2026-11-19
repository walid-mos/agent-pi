import assert from 'node:assert/strict'
import test from 'node:test'
import { stripVTControlCharacters } from 'node:util'

import {
	AssistantMessageComponent,
	initTheme,
} from '@earendil-works/pi-coding-agent'
import { visibleWidth } from '@earendil-works/pi-tui'

import { installAssistantSurface } from '../extensions/ui/renderers/assistant-surface.ts'

import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { MarkdownTransformer } from '@earendil-works/pi-coding-agent'

const nativeModule = new URL(
	'modes/interactive/components/mermaid.js',
	import.meta.resolve('@earendil-works/pi-coding-agent'),
)
const nativeMermaid: unknown = await import(nativeModule.href)
assert.ok(
	typeof nativeMermaid === 'object' &&
		nativeMermaid !== null &&
		'createMermaidMarkdownTransformer' in nativeMermaid &&
		typeof nativeMermaid.createMermaidMarkdownTransformer === 'function',
)
const transformer: unknown = nativeMermaid.createMermaidMarkdownTransformer({
	getMode: () => 'streaming',
})
assert.ok(typeof transformer === 'function')
const nativeTransformer: MarkdownTransformer = (source, context) => {
	const transformed: unknown = transformer(source, context)
	assert.ok(typeof transformed === 'string')
	return transformed
}

initTheme('dark')

const approvalFlow = `\`\`\`mermaid
flowchart LR
    A["Pot submits a task"] --> B["Mac puts it in a quiet approval queue"]
    B --> C{"Your approval matches this Mac and this exact task?"}
    C -->|Yes| D["Mac starts Pi in Herdr once"]
    C -->|No, expired, or already used| E["Nothing starts"]
    D --> F["Result goes back to the Pot"]
\`\`\``

function renderAssistant(
	source: string,
	width: number,
	isStreaming = false,
): string {
	const component = new AssistantMessageComponent(
		undefined,
		false,
		undefined,
		undefined,
		0,
		[nativeTransformer],
	)
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
	const message: AssistantMessage = {
		role: 'assistant',
		content: [{ type: 'text', text: source }],
		api: 'openai-responses',
		provider: 'openai',
		model: 'fixture',
		usage: { ...usage, totalTokens: 0, cost: { ...usage, total: 0 } },
		stopReason: 'stop',
		timestamp: 0,
	}
	const dispose = installAssistantSurface(AssistantMessageComponent)
	try {
		component.updateContent(message, isStreaming)
		const rows = component.render(width).map(stripVTControlCharacters)
		assert.ok(rows.every(row => visibleWidth(row) <= width))
		return rows.join('\n')
	} finally {
		dispose()
	}
}

test('the wide approval flow remains a diagram at 168 and 72 columns', () => {
	for (const width of [168, 72]) {
		const output = renderAssistant(approvalFlow, width)
		assert.match(output, /Pot submits a task/)
		assert.match(output, /Mac puts it in a quiet/)
		assert.match(output, /Your approval matches/)
		assert.match(output, /this Mac and this exact/)
		assert.match(output, /task\?/)
		assert.match(output, /Mac starts Pi in Herdr/)
		assert.match(output, /Nothing starts/)
		assert.match(output, /Result goes back to the/)
		assert.match(output, /No, expired, or already used/)
		assert.match(output, /Yes/)
		assert.match(output, /▼/)
		assert.doesNotMatch(output, /flowchart LR|Mermaid source/)
	}
})

test('an overflowing right-to-left graph reflows from bottom to top', () => {
	const output = renderAssistant(
		`~~~Mermaid
%% Keep the heading comment
 graph RL; A[Input] --> B[Process] --> C[Output]
~~~`,
		32,
	)
	assert.match(output, /Output[\s\S]*▲[\s\S]*Process[\s\S]*▲[\s\S]*Input/)
	assert.doesNotMatch(output, /Mermaid source/)
})

test('a flowchart too wide even after reorientation shows its original source', () => {
	const output = renderAssistant(approvalFlow, 48)
	assert.match(output, /Mermaid source/)
	assert.match(output, /exceeds 48 columns/)
	assert.match(output, /flowchart LR/)
	assert.match(output, /C -->\|No, expired, or already used\|/)
	assert.match(output, /Nothing starts/)
})

test('a wide sequence diagram fits when space permits and shows source otherwise', () => {
	const sequence = `\`\`\`mermaid
sequenceDiagram
    participant A as A participant with a long name
    participant B as Another participant with a long name
    A->>B: A long message which the renderer should preserve
\`\`\``
	const wide = renderAssistant(sequence, 168)
	assert.match(wide, /▶/)
	assert.doesNotMatch(wide, /sequenceDiagram|Mermaid source/)
	const narrow = renderAssistant(sequence, 72)
	assert.match(narrow, /exceeds 72 columns/)
	assert.match(narrow, /sequenceDiagram/)
	assert.match(narrow, /A->>B: A long message/)
})

test('unsupported diagrams retain source without a width diagnosis', () => {
	const output = renderAssistant(
		'```mermaid\ngantt\n    title Release plan\n```',
		168,
	)
	assert.match(output, /Mermaid source/)
	assert.match(output, /gantt/)
	assert.match(output, /title Release plan/)
	assert.doesNotMatch(output, /exceeds|columns/)
})

test('malformed diagrams retain both their source and the native diagnostic', () => {
	const output = renderAssistant(
		'```mermaid\ngraph TD\n    A[broken --> B\n```',
		168,
	)
	assert.match(output, /Mermaid source/)
	assert.match(output, /A\[broken --> B/)
	assert.match(output, /label is missing its closing/)
})

test('an unrendered streaming fence stays a placeholder', () => {
	const output = renderAssistant(approvalFlow.slice(0, -3), 72, true)
	assert.match(output, /Mermaid diagram rendering…/)
	assert.doesNotMatch(
		output,
		/flowchart LR|Pot submits a task|Mermaid source/,
	)
})

test('retries preserve nearby prose, ordinary fences and native diagrams', () => {
	const source = [
		'Before the charts.',
		'```mermaid\nflowchart LR\n  A[Start] --> B[Done]\n```',
		approvalFlow,
		'After the charts. **Still bold.**',
		'````markdown\n```mermaid\nShown as code\n```\n````',
	].join('\n\n')
	const output = renderAssistant(source, 72)
	assert.match(output, /Before the charts\.[\s\S]*Start.*▶.*Done/)
	assert.match(
		output,
		/Pot submits a task[\s\S]*After the charts\. Still bold\./,
	)
	assert.match(output, /```mermaid\s*\n[^\n]*Shown as code/)
	assert.doesNotMatch(output, /Mermaid source|could not fit/)
})
