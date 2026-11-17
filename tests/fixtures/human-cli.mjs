const [, , operation, id] = process.argv
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = chunks.length
	? JSON.parse(Buffer.concat(chunks).toString('utf8'))
	: undefined
if (input?.mode === 'fail') {
	process.stderr.write(JSON.stringify(input))
	process.stdout.write(JSON.stringify(input))
	process.exitCode = 1
} else if (input?.mode === 'reflect') {
	process.stdout.write(JSON.stringify(input))
} else {
	process.stdout.write(
		JSON.stringify({
			operation,
			id,
			argumentCount: process.argv.length,
			receivedOnStdin: !!input?.secret,
		}),
	)
}
