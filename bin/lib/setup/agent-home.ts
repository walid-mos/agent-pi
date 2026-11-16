import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const AGENT_DIRECTORY_VARIABLE = 'PI_CODING_AGENT_DIR'

export function checkAgentHome(
	agentDirectory: string,
	environment: NodeJS.ProcessEnv,
): void {
	const home = realpathSync(agentDirectory)
	const configured = environment[AGENT_DIRECTORY_VARIABLE]
	if (configured) {
		if (realpathSync(configured) === home) return
		throw new Error(
			`${AGENT_DIRECTORY_VARIABLE}=${configured} is not this checkout (${home}); unset it or run the setup of that directory.`,
		)
	}
	const standard = join(homedir(), '.pi', 'agent')
	if (home !== standard)
		console.log(
			`Start Pi with ${AGENT_DIRECTORY_VARIABLE}=${home}; Pi reads ${standard} by default.`,
		)
}
