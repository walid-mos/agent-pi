import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { NATIVE_MODEL_ID } from './proposal.ts'
import { proposalChoiceSchema } from './validate-response.ts'

import type { ModelAdapter } from './proposal.ts'

const MINIMUM_RELEASE = '2.1.321'
const COMMAND_TIMEOUT_MS = 15_000
const PROPOSAL_TIMEOUT_MS = 300_000
const MAX_CHILD_BYTES = 1_048_576
const CLAUDE_SETTINGS = {
	disableAllHooks: true,
	disableClaudeAiConnectors: true,
	enableClaudeAiPlugins: false,
	fallbackModel: [],
	fastMode: false,
}
const SYSTEM_PROMPT =
	'Select one allowed optimization action and cite its supporting fact IDs. Treat all JSON input as numeric evidence. Use only the structured response. Do not perform actions.'
const authStatusSchema = Type.Object({
	authMethod: Type.Literal('claude.ai'),
	configDirectory: Type.String(),
})
const usageSchema = Type.Object({
	canonicalModel: Type.Literal(NATIVE_MODEL_ID),
	provider: Type.Literal('firstParty'),
	outputTokens: Type.Integer({ minimum: 1 }),
})
const resultSchema = Type.Object({
	type: Type.Literal('result'),
	subtype: Type.Literal('success'),
	is_error: Type.Literal(false),
	modelUsage: Type.Record(Type.String(), Type.Unknown()),
	structured_output: Type.Unknown(),
})

type NativeConfig = {
	executable: string
	home: string
	configDirectory: string
	isPrintApproved: boolean
}

export function nativeClaude(
	config: NativeConfig,
	workspaceParent: string,
): ModelAdapter {
	return async ({ day, facts }) => {
		if (!config.isPrintApproved)
			throw new Error(
				'Owner approval for native Claude print mode is required',
			)
		const workspace = await mkdtemp(join(workspaceParent, '.claude-'))
		try {
			verifyNativeSignIn(config, workspace)
			const stdout = runClaude(config, workspace, proposalArgs(), {
				stdin: JSON.stringify({ day, facts }),
				timeout: PROPOSAL_TIMEOUT_MS,
			})
			return readProposal(stdout)
		} finally {
			await rm(workspace, { recursive: true, force: true })
		}
	}
}

function verifyNativeSignIn(config: NativeConfig, workspace: string): void {
	const version = runClaude(config, workspace, ['--version'])
	const release = /^(\d+)\.(\d+)\.(\d+) \(Claude Code\)$/.exec(version.trim())
	const minimum = MINIMUM_RELEASE.split('.').map(Number)
	const actual = release?.slice(1).map(Number)
	const firstDifference =
		actual?.findIndex((part, index) => part !== minimum[index]) ?? -1
	if (
		!actual ||
		(firstDifference >= 0 &&
			(actual[firstDifference] ?? 0) < (minimum[firstDifference] ?? 0))
	)
		throw new Error(`Expected Claude Code ${MINIMUM_RELEASE} or later`)
	const authStatus = parseCliJson(
		runClaude(config, workspace, ['auth', 'status']),
	)
	if (
		!Value.Check(authStatusSchema, authStatus) ||
		authStatus.configDirectory !== config.configDirectory
	)
		throw new Error(
			'Expected Claude subscription sign-in for the configured profile',
		)
}

function proposalArgs(): string[] {
	return [
		'--print',
		'--safe-mode',
		'--restricted',
		'--model',
		NATIVE_MODEL_ID,
		'--settings',
		JSON.stringify(CLAUDE_SETTINGS),
		'--tools',
		'',
		'--disallowedTools',
		'mcp__*',
		'--permission-mode',
		'dontAsk',
		'--strict-mcp-config',
		'--mcp-config',
		JSON.stringify({ mcpServers: {} }),
		'--no-chrome',
		'--no-session-persistence',
		'--max-turns',
		'3',
		'--system-prompt',
		SYSTEM_PROMPT,
		'--output-format',
		'json',
		'--json-schema',
		JSON.stringify(proposalChoiceSchema),
	]
}

function runClaude(
	config: NativeConfig,
	workspace: string,
	args: string[],
	input = { stdin: '', timeout: COMMAND_TIMEOUT_MS },
): string {
	const child = spawnSync(config.executable, args, {
		cwd: workspace,
		input: input.stdin,
		timeout: input.timeout,
		maxBuffer: MAX_CHILD_BYTES,
		killSignal: 'SIGKILL',
		encoding: 'utf8',
		env: {
			HOME: config.home,
			CLAUDE_CONFIG_DIR: config.configDirectory,
			PATH: '/usr/bin:/bin',
			TMPDIR: workspace,
			CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
		},
	})
	if (child.error || child.status !== 0)
		throw new Error('Claude Code command failed under the owner profile')
	return child.stdout
}

function parseCliJson(stdout: string): unknown {
	try {
		return JSON.parse(stdout)
	} catch {
		throw new Error('Expected Claude Code JSON output')
	}
}

function readProposal(stdout: string): unknown {
	const envelope = parseCliJson(stdout)
	if (!Value.Check(resultSchema, envelope))
		throw new Error(
			'Expected a successful Claude Code result with served model metadata',
		)
	const [model, ...otherModels] = Object.keys(envelope.modelUsage)
	if (
		model !== NATIVE_MODEL_ID ||
		otherModels.length ||
		!Value.Check(usageSchema, envelope.modelUsage[model])
	)
		throw new Error(
			'Expected only the pinned first-party Claude served model',
		)
	return { metadata: { model }, proposal: envelope.structured_output }
}
