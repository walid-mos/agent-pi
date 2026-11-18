import assert from 'node:assert/strict'
import test from 'node:test'
import { stripVTControlCharacters } from 'node:util'

import { quotaStrip } from '../extensions/ui/hud-footer/render-quota.ts'

const servedModel = 'inco/deepseek-v4.1-flash:fast'
const quotaOptions = { magpieModel: servedModel }

test('Magpie footer shows the concrete model in the full and compact quota strip', () => {
	for (const compact of [false, true]) {
		const strip = stripVTControlCharacters(
			quotaStrip({}, 'magpie', { ...quotaOptions, compact }),
		)
		assert.ok(strip.endsWith(servedModel), strip)
		assert.doesNotMatch(strip, /no quota data/)
	}
})

test('Magpie footer reports an unknown model before a response identifies it', () => {
	const strip = stripVTControlCharacters(quotaStrip({}, 'magpie'))
	assert.match(strip, /model unknown$/)
})

test('another provider keeps its quota display even with a Magpie model value', () => {
	const strip = stripVTControlCharacters(
		quotaStrip({}, 'openai', quotaOptions),
	)
	assert.match(strip, /openai.*no quota data$/)
})
