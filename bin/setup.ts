import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkAgentHome } from './lib/setup/agent-home.ts'
import { baseRoots, installDependencies } from './lib/setup/dependencies.ts'
import { planModels, writeModels } from './lib/setup/models.ts'
import {
	checkOverlayConfig,
	checkOverlayRoots,
	registeredOverlayRoots,
} from './lib/setup/overlays.ts'
import { applySettings, pinnedSettings } from './lib/setup/settings.ts'

const AGENT_DIRECTORY = dirname(dirname(fileURLToPath(import.meta.url)))

async function setup(): Promise<void> {
	checkAgentHome(AGENT_DIRECTORY, process.env)
	installDependencies(baseRoots(AGENT_DIRECTORY))
	const overlayRoots = await registeredOverlayRoots(AGENT_DIRECTORY)
	const settings = pinnedSettings(AGENT_DIRECTORY, overlayRoots)
	await checkOverlayRoots(AGENT_DIRECTORY, overlayRoots, settings.settings)
	installDependencies(overlayRoots)
	await checkOverlayConfig(AGENT_DIRECTORY)
	const models = planModels(AGENT_DIRECTORY, process.env)
	applySettings(AGENT_DIRECTORY, settings)
	writeModels(models)
}

try {
	await setup()
} catch (error) {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
}
