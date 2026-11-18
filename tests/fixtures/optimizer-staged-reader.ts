import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function installFixtureReader(root: string): Promise<string> {
	const pinned = process.env.NIGHTLY_USAGE_PINNED_PIPELINE
	if (pinned) return join(pinned, 'dailySnapshot.ts')
	const decoder = join(root, 'dailySnapshot.ts')
	await writeFile(
		decoder,
		'export const SNAPSHOT_LIMIT = 8192; export function decodeSnapshot() { throw Error("Use the staged publication reader") }',
	)
	await writeFile(
		join(root, 'readDailyPublication.ts'),
		`export async function readDailyPublication(store, roster, day) {
		return { day, hosts: await Promise.all(roster.map(async ({hostId}) => {
			const stored = await store.get(\`usage/v1/\${hostId}/\${day}.json\`);
			if (!stored) return {hostId, status: 'missing'};
			try { const snapshot = await new Response(stored.body).json(); return snapshot.hostId === hostId && snapshot.day === day ? {hostId, status: 'delivered', usage: snapshot.usage} : {hostId, status: 'invalid'}; }
			catch { return {hostId, status: 'invalid'}; }
		})) }
	}`,
	)
	return decoder
}
