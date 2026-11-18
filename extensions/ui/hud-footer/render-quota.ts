// Select the active provider's quota segment. Segment formatting stays pure.
import { MAGPIE_PROVIDER } from '#lib/magpie.ts'
import { PI_PALETTE as LATTE } from '#lib/ui/design-system/palette.ts'
import { foregroundHex as fgHex } from '#lib/ui/design-system/terminal-color.ts'

import {
	deepseekSegment,
	incoSegment,
	kimiSegment,
	openaiSegment,
	openRouterSegment,
	xaiSegment,
} from './quota-segments.ts'
import { quietText as QUIET, thinSep } from './text.ts'
import { ICONS } from './theme.ts'

import type { QuotaRenderOptions } from './quota-segments.ts'
import type { QuotaCache } from './quotas.ts'

/** Unavailable billing states have no invented counters. */
function noQuotaDataPart(provider: string): string {
	const label = fgHex(LATTE.overlay1, 'no quota data')
	if (!provider.length) return label
	return `${QUIET(provider)} ${thinSep()} ${label}`
}

/** Compose the full quota strip for one provider snapshot. */
export function quotaStrip(
	quotas: QuotaCache,
	provider: string | undefined,
	options: QuotaRenderOptions = {},
): string {
	const activeProvider = (provider ?? '').toLowerCase()
	if (activeProvider === MAGPIE_PROVIDER) return magpieStrip(options)
	const parts = activeProviderParts(quotas, activeProvider, options)
	if (parts.length) return quotaContent(parts)
	return quotaContent([noQuotaDataPart(activeProvider)])
}

function magpieStrip(options: QuotaRenderOptions): string {
	const model = options.magpieModel
		? fgHex(LATTE.text, options.magpieModel)
		: fgHex(LATTE.overlay1, 'model unknown')
	return quotaContent(
		options.compact ? [model] : [QUIET(MAGPIE_PROVIDER), model],
	)
}

/** Segments of the active provider, in the classic footer order. */
function activeProviderParts(
	quotas: QuotaCache,
	activeProvider: string,
	options: QuotaRenderOptions,
): string[] {
	const { kimi, openrouter, openai, xai, deepseek, inco } = quotas
	const segments = {
		kimi: () => (kimi ? kimiSegment(kimi, options) : ''),
		openrouter: () => (openrouter ? openRouterSegment(openrouter) : ''),
		openai: () => (openai ? openaiSegment(openai, options) : ''),
		xai: () => (xai ? xaiSegment(xai, options) : ''),
		deepseek: () => (deepseek ? deepseekSegment(deepseek, options) : ''),
		inco: () => (inco ? incoSegment(inco) : ''),
	}
	return Object.entries(segments)
		.filter(([provider]) => activeProvider.includes(provider))
		.map(([, render]) => render())
		.filter(Boolean)
}

function quotaContent(parts: string[]): string {
	return `${fgHex(LATTE.subtext0, ICONS.quota)} ${parts.join(` ${thinSep()} `)}`
}
