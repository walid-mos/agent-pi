type GlobToken = { source: string; end: number }

const GLOBSTAR = '**'.length
const SPECIAL = /[.+^$()|[\]\\]/g
const WILDCARDS: Readonly<Record<string, string>> = {
	'*': '[^/]*',
	'?': '[^/]',
}

function braceAlternatives(glob: string, index: number): GlobToken | undefined {
	if (glob[index] !== '{') return undefined
	const end = glob.indexOf('}', index)
	if (end === -1) return undefined
	const alternatives = glob
		.slice(index + 1, end)
		.split(',')
		.map(part => part.replace(SPECIAL, '\\$&'))
	return { source: `(?:${alternatives.join('|')})`, end }
}

function globstar(glob: string, index: number): GlobToken {
	const spansDirectory = glob[index + GLOBSTAR] === '/'
	return {
		source: spansDirectory ? '(?:.*/)?' : '.*',
		end: index + (spansDirectory ? GLOBSTAR : GLOBSTAR - 1),
	}
}

function tokenAt(glob: string, index: number): GlobToken {
	const braces = braceAlternatives(glob, index)
	if (braces) return braces
	if (glob.startsWith('**', index)) return globstar(glob, index)
	const char = glob.charAt(index)
	return {
		source: WILDCARDS[char] ?? char.replace(SPECIAL, '\\$&'),
		end: index,
	}
}

export function globToRegExp(glob: string): RegExp {
	let source = ''
	for (let index = 0; index < glob.length; index += 1) {
		const token = tokenAt(glob, index)
		source += token.source
		index = token.end
	}
	return new RegExp(`^${source}$`)
}
