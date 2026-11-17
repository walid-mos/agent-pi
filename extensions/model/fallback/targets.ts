import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'

import { errorText } from '#lib/error-text.ts'
import { CODEX_GROUP_PREFIX, resolveCodexGroup } from '#lib/magpie-codex.ts'

import { modelReference, parseModelReference } from './chain.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { ModelRegistry } from '@earendil-works/pi-coding-agent'

type Registry = Pick<ModelRegistry, 'find' | 'hasConfiguredAuth'>
type RegistryModel = NonNullable<ReturnType<Registry['find']>>
type FallbackTarget = {
	reference: string
	model: RegistryModel
	thinkingLevel: ModelThinkingLevel | undefined
}

const NOT_IN_REGISTRY =
	'not in the Pi model registry. Add its capability entry to models.pinned.json.'
const UNSUPPORTED_EFFORT = 'does not support the group effort'

export function findChainModel(
	registry: Pick<Registry, 'find'>,
	reference: string,
): RegistryModel | undefined {
	const parsed = parseModelReference(reference)
	if (!parsed) return undefined
	return registry.find(parsed.provider, parsed.modelId)
}

function codexTarget(
	group: string,
	registry: Registry,
	providersPath: string | undefined,
): FallbackTarget | undefined {
	const selection = resolveCodexGroup(group, providersPath)
	const model = registry.find(selection.provider, selection.id)
	if (!model)
		throw new Error(
			`${selection.provider}/${selection.id} ${NOT_IN_REGISTRY}`,
		)
	if (!registry.hasConfiguredAuth(model)) return undefined
	if (!getSupportedThinkingLevels(model).includes(selection.thinkingLevel))
		throw new Error(
			`${modelReference(model)} ${UNSUPPORTED_EFFORT} ${selection.thinkingLevel}.`,
		)
	return {
		reference: modelReference(model),
		model,
		thinkingLevel: selection.thinkingLevel,
	}
}

function plainTarget(
	reference: string,
	registry: Registry,
): FallbackTarget | undefined {
	const model = findChainModel(registry, reference)
	if (!model || !registry.hasConfiguredAuth(model)) return undefined
	return { reference: modelReference(model), model, thinkingLevel: undefined }
}

function resolveTarget(
	reference: string,
	registry: Registry,
	providersPath: string | undefined,
): FallbackTarget | undefined {
	if (reference.startsWith(CODEX_GROUP_PREFIX))
		return codexTarget(
			reference.slice(CODEX_GROUP_PREFIX.length),
			registry,
			providersPath,
		)
	return plainTarget(reference, registry)
}

export function resolveFallbackChain(
	chain: readonly string[],
	registry: Registry,
	warn: (message: string) => void,
	providersPath?: string,
): FallbackTarget[] {
	return chain.flatMap(reference => {
		try {
			const target = resolveTarget(reference, registry, providersPath)
			return target ? [target] : []
		} catch (error) {
			warn(`Fallback: skipped ${reference}: ${errorText(error)}`)
			return []
		}
	})
}
