export function defined<T>(value: T | null | undefined, what: string): T {
	if (value == null) throw new Error(`missing ${what}`);
	return value;
}
