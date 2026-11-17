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
			`${selection.provider}/${selection.id} not in the Pi model registry. Add its capability entry to models.pinned.json.`,
		)
	if (!registry.hasConfiguredAuth(model)) return undefined
	if (!getSupportedThinkingLevels(model).includes(selection.thinkingLevel))
		throw new Error(
			`${modelReference(model)} does not support the group effort ${selection.thinkingLevel}.`,
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

export function levelForTarget(
	groupLevel: ModelThinkingLevel | undefined,
	sessionLevel: ModelThinkingLevel | undefined,
	previousLevel: ModelThinkingLevel,
): ModelThinkingLevel {
	return groupLevel ?? sessionLevel ?? previousLevel
}

export function resolveFallbackChain(
	chain: readonly string[],
	registry: Registry,
	warn: (message: string) => void,
	providersPath?: string,
): Array<FallbackTarget & { configuredReference: string }> {
	return chain.flatMap(reference => {
		try {
			const target = reference.startsWith(CODEX_GROUP_PREFIX)
				? codexTarget(
						reference.slice(CODEX_GROUP_PREFIX.length),
						registry,
						providersPath,
					)
				: plainTarget(reference, registry)
			return target ? [{ ...target, configuredReference: reference }] : []
		} catch (error) {
			warn(`Fallback: skipped ${reference}: ${errorText(error)}`)
			return []
		}
	})
}
