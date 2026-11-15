/**
 * Setting-level comparison of two server.properties texts, using the same parser as the form
 * (effective value = last occurrence of a key). Comments, order and formatting are not
 * settings; when only they differ, `textOnly` says so instead of reporting no change.
 */
import { parseProperties } from '#lib/files/properties.js';

export type PropertyChange =
	| { kind: 'added'; key: string; to: string }
	| { kind: 'removed'; key: string; from: string }
	| { kind: 'changed'; key: string; from: string; to: string };

export interface PropertiesDiff {
	changes: PropertyChange[];
	added: number;
	removed: number;
	changed: number;
	/** Settings are identical but the text differs (comments, order, spacing, duplicates). */
	textOnly: boolean;
}

export function diffProperties(fromText: string, toText: string): PropertiesDiff {
	const from = parseProperties(fromText).effective;
	const to = parseProperties(toText).effective;
	const changes: PropertyChange[] = [];
	for (const [key, entry] of to) {
		const before = from.get(key);
		if (!before) changes.push({ kind: 'added', key, to: entry.value });
		else if (before.value !== entry.value)
			changes.push({ kind: 'changed', key, from: before.value, to: entry.value });
	}
	for (const [key, entry] of from) {
		if (!to.has(key)) changes.push({ kind: 'removed', key, from: entry.value });
	}
	const order = { changed: 0, added: 1, removed: 2 } as const;
	changes.sort((a, b) => order[a.kind] - order[b.kind] || a.key.localeCompare(b.key));
	const count = (kind: PropertyChange['kind']) => changes.filter((c) => c.kind === kind).length;
	return {
		changes,
		added: count('added'),
		removed: count('removed'),
		changed: count('changed'),
		textOnly: changes.length === 0 && fromText !== toText
	};
}
