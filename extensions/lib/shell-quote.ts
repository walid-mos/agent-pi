/** One POSIX shell word: single-quoted, embedded quotes closed and escaped. */
export function quote(text: string): string {
	return `'${text.replaceAll("'", `'\\''`)}'`
}
