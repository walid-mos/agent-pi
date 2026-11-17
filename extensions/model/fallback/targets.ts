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

function registryModel(
	selection: { provider: string; id: string } | undefined,
	reference: string,
	registry: Registry,
): RegistryModel | undefined {
	if (selection) return registry.find(selection.provider, selection.id)
	const parsed = parseModelReference(reference)
	if (!parsed) return undefined
	return registry.find(parsed.provider, parsed.modelId)
}

function resolveTarget(
	reference: string,
	registry: Registry,
	providersPath: string | undefined,
): FallbackTarget | undefined {
	const selection = reference.startsWith(CODEX_GROUP_PREFIX)
		? resolveCodexGroup(
				reference.slice(CODEX_GROUP_PREFIX.length),
				providersPath,
			)
		: undefined
	const model = registryModel(selection, reference, registry)
	if (!model) {
		if (!selection) return undefined
		throw new Error(
			`${selection.provider}/${selection.id} ${NOT_IN_REGISTRY}`,
		)
	}
	if (!registry.hasConfiguredAuth(model)) return undefined
	if (
		selection &&
		!getSupportedThinkingLevels(model).includes(selection.thinkingLevel)
	)
		throw new Error(
			`${modelReference(model)} ${UNSUPPORTED_EFFORT} ${selection.thinkingLevel}.`,
		)
	return {
		reference: modelReference(model),
		model,
		thinkingLevel: selection?.thinkingLevel,
	}
}

export function resolveFallbackChain(
	chain: readonly string[],
	registry: Registry,
	warn: (message: string) => void,
	providersPath?: string,
): FallbackTarget[] {
	return chain.flatMap(reference => {
		try {
			return filterDefined([
				resolveTarget(reference, registry, providersPath),
			])
		} catch (error) {
			warn(`Fallback: skipped ${reference}: ${errorText(error)}`)
			return []
		}
	})
}

function filterDefined(
	targets: (FallbackTarget | undefined)[],
): FallbackTarget[] {
	return targets.filter(
		(target): target is FallbackTarget => Boolean(target),
	)
}
