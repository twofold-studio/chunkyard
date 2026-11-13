import type { FileEntry } from '#lib/api/index.js';

/**
 * Server-relative POSIX path helpers. The UI only ever produces paths built from
 * validated segments, so it never sends `..`, `.`, absolute paths or backslashes;
 * the backend still enforces containment.
 */

export const ROOT = '';

/** Longest single name accepted by common filesystems (bytes approximated as UTF-16 units). */
const MAX_NAME = 255;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Returns why `name` is not a single safe path segment, or `null` when it is. */
export function validateName(name: string): string | null {
	if (name.length === 0 || name.trim().length === 0) return 'Enter a name.';
	if (name === '.' || name === '..') return 'This name is reserved.';
	if (name.includes('/') || name.includes('\\')) return 'A name cannot contain / or \\.';
	if (CONTROL.test(name)) return 'A name cannot contain control characters.';
	if (name.length > MAX_NAME) return `Use at most ${MAX_NAME} characters.`;
	return null;
}

export type PathResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * Validates a destination typed by the owner (`plugins/old/config.yml`). Leading and
 * trailing slashes are trimmed; every segment must pass {@link validateName}.
 */
export function parseRelativePath(input: string): PathResult {
	const trimmed = input.trim().replace(/^\/+/, '').replace(/\/+$/, '');
	if (!trimmed) return { ok: false, error: 'Enter a path inside the server directory.' };
	const segments = trimmed.split('/');
	for (const segment of segments) {
		if (segment === '') return { ok: false, error: 'A path cannot contain empty segments (//).' };
		const error = validateName(segment);
		if (error) return { ok: false, error: segment === '..' ? 'Use a path without “..”.' : error };
	}
	return { ok: true, path: segments.join('/') };
}

/** Joins a directory and a validated name. */
export function joinPath(dir: string, name: string): string {
	return dir ? `${dir}/${name}` : name;
}

export function parentPath(path: string): string {
	const index = path.lastIndexOf('/');
	return index < 0 ? ROOT : path.slice(0, index);
}

export function baseName(path: string): string {
	const index = path.lastIndexOf('/');
	return index < 0 ? path : path.slice(index + 1);
}

export interface Crumb {
	name: string;
	path: string;
}

/** Root first, then one crumb per segment. */
export function breadcrumbs(path: string): Crumb[] {
	const crumbs: Crumb[] = [{ name: 'Server', path: ROOT }];
	if (!path) return crumbs;
	let current = '';
	for (const segment of path.split('/')) {
		current = joinPath(current, segment);
		crumbs.push({ name: segment, path: current });
	}
	return crumbs;
}

export type SortKey = 'name' | 'size' | 'modified';
export type SortDirection = 'asc' | 'desc';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Directories always come first; the chosen key orders within each group. */
export function sortEntries(
	entries: readonly FileEntry[],
	key: SortKey,
	direction: SortDirection
): FileEntry[] {
	const sign = direction === 'asc' ? 1 : -1;
	const time = (entry: FileEntry) => (entry.modifiedAt ? Date.parse(entry.modifiedAt) || 0 : 0);
	return [...entries].sort((a, b) => {
		const aDir = a.kind === 'directory' ? 0 : 1;
		const bDir = b.kind === 'directory' ? 0 : 1;
		if (aDir !== bDir) return aDir - bDir;
		let result = 0;
		if (key === 'size') result = a.size - b.size;
		else if (key === 'modified') result = time(a) - time(b);
		if (result === 0) result = collator.compare(a.name, b.name);
		return result * sign;
	});
}

export function filterEntries(entries: readonly FileEntry[], query: string): FileEntry[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...entries];
	return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '—';
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return unit === 0
		? `${value} B`
		: `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}

/** Upload limit per file, mirrored from the backend. */
export const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
/** Editor limit, mirrored from the backend. */
export const MAX_EDIT_BYTES = 1024 * 1024;

export const SERVER_PROPERTIES = 'server.properties';
