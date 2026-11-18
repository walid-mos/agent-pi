import { constants as http } from 'node:http2'

import {
	GROUP_PREFIX,
	MAGPIE_PROVIDER,
	MAGPIE_ROUTE_CHANGED_EVENT,
} from '#lib/magpie.ts'

import { footerState, requestRenderSafely } from './state.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const SERVED_MODEL_HEADER = 'x-magpie-model'

function setServedModel(model: string | undefined): void {
	if (footerState.magpieModel === model) return
	footerState.magpieModel = model
	requestRenderSafely()
}

export function trackMagpieModel(pi: ExtensionAPI): void {
	let isMagpieRequest = false
	const reset = (): void => {
		isMagpieRequest = false
		setServedModel(undefined)
	}

	pi.events.on(MAGPIE_ROUTE_CHANGED_EVENT, reset)
	pi.on('session_start', reset)
	pi.on('session_shutdown', reset)
	pi.on('session_tree', reset)
	pi.on('model_select', reset)
	pi.on('before_provider_request', (_event, ctx) => {
		isMagpieRequest = ctx.model?.provider === MAGPIE_PROVIDER
		setServedModel(undefined)
	})
	pi.on('after_provider_response', ({ headers, status }) => {
		if (!isMagpieRequest) return
		const model = headers[SERVED_MODEL_HEADER]?.trim()
		const isSuccess =
			status >= http.HTTP_STATUS_OK &&
			status < http.HTTP_STATUS_MULTIPLE_CHOICES
		setServedModel(
			isSuccess && model && !model.startsWith(GROUP_PREFIX)
				? model
				: undefined,
		)
	})
}
