import type { ServerState, ServerView } from '#lib/api/index.js';
import { isArchived } from '#lib/exports/backups.js';
import { SOFTWARE_LABELS } from './software.js';

/**
 * Client-side search, filter and sort over the records returned by the current
 * `GET /api/v1/servers` response. It never claims to cover servers the backend
 * did not return.
 */

export type StateFilter = 'all' | ServerState;
/** `custom` is a manual JAR server (`software == null`). */
export type SoftwareFilter = 'all' | 'custom' | string;
export type SortKey = 'name' | 'state' | 'port';
/** Local instance files present, or archived to an S3 backup (`archive` set). */
export type LocationFilter = 'all' | 'local' | 'archived';

export interface ListView {
	query: string;
	state: StateFilter;
	software: SoftwareFilter;
	sort: SortKey;
	/** Optional so older callers default to all instances. */
	location?: LocationFilter;
}

export const DEFAULT_VIEW: ListView = { query: '', state: 'all', software: 'all', sort: 'name' };

export const STATE_LABELS: Record<ServerState, string> = {
	running: 'Running',
	paused: 'Paused',
	stopped: 'Stopped',
	unknown: 'Unknown'
};

export const LOCATION_LABELS: Record<Exclude<LocationFilter, 'all'>, string> = {
	local: 'Local',
	archived: 'Archived'
};

export const SORT_LABELS: Record<SortKey, string> = {
	name: 'Name',
	state: 'State',
	port: 'Port'
};

const STATE_RANK: Record<string, number> = { running: 0, paused: 1, stopped: 2, unknown: 3 };

export function softwareKey(server: Pick<ServerView, 'software'>): string {
	const type = server.software?.type;
	return typeof type === 'string' && type ? type : 'custom';
}

export function softwareFilterLabel(key: string): string {
	if (key === 'custom') return 'Custom JAR';
	return (SOFTWARE_LABELS as Record<string, string>)[key] ?? key;
}

/** Distinct software keys present in the list, in label order. */
export function softwareOptions(servers: readonly ServerView[]): string[] {
	const keys = new Set(servers.map(softwareKey));
	return [...keys].sort((a, b) => softwareFilterLabel(a).localeCompare(softwareFilterLabel(b)));
}

function haystack(server: ServerView): string {
	const software = server.software as { version?: unknown } | null | undefined;
	const parts = [
		server.name,
		softwareKey(server),
		softwareFilterLabel(softwareKey(server)),
		typeof software?.version === 'string' ? software.version : '',
		server.launch?.version ?? '',
		String(server.port),
		isArchived(server) ? 'archived' : 'local'
	];
	return parts.join(' ').toLowerCase();
}

/** Every whitespace-separated term must match name, software, version or port. */
export function matchesQuery(server: ServerView, query: string): boolean {
	const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
	if (!terms.length) return true;
	const text = haystack(server);
	return terms.every((term) => text.includes(term));
}

const byName = (a: ServerView, b: ServerView) =>
	a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) ||
	a.id.localeCompare(b.id);

export function compareServers(sort: SortKey): (a: ServerView, b: ServerView) => number {
	switch (sort) {
		case 'state':
			return (a, b) =>
				(STATE_RANK[a.status.state] ?? 9) - (STATE_RANK[b.status.state] ?? 9) || byName(a, b);
		case 'port':
			return (a, b) => a.port - b.port || byName(a, b);
		default:
			return byName;
	}
}

export function applyView(servers: readonly ServerView[], view: ListView): ServerView[] {
	return servers
		.filter(
			(server) =>
				(view.state === 'all' || server.status.state === view.state) &&
				(view.software === 'all' || softwareKey(server) === view.software) &&
				matchesLocation(server, view.location ?? 'all') &&
				matchesQuery(server, view.query)
		)
		.sort(compareServers(view.sort));
}

function matchesLocation(server: ServerView, location: LocationFilter): boolean {
	if (location === 'all') return true;
	return isArchived(server) === (location === 'archived');
}

export function isFiltered(view: ListView): boolean {
	return (
		view.query.trim() !== '' ||
		view.state !== 'all' ||
		view.software !== 'all' ||
		(view.location ?? 'all') !== 'all'
	);
}

/** "3 servers" or "2 of 5 loaded servers" — never a claim about servers not returned. */
export function countLabel(shown: number, loaded: number, filtered: boolean): string {
	const noun = (n: number) => (n === 1 ? 'server' : 'servers');
	if (!filtered) return `${loaded} ${noun(loaded)}`;
	return `${shown} of ${loaded} loaded ${noun(loaded)}`;
}

const STORAGE_KEY = 'chunkyard.servers.view';
const SORTS: readonly SortKey[] = ['name', 'state', 'port'];

/** Only the sort order is persisted: a harmless view preference, no server data. */
export function loadSortPreference(storage: Pick<Storage, 'getItem'> | undefined): SortKey {
	try {
		const value = storage?.getItem(STORAGE_KEY);
		return SORTS.includes(value as SortKey) ? (value as SortKey) : 'name';
	} catch {
		return 'name';
	}
}

export function saveSortPreference(storage: Pick<Storage, 'setItem'> | undefined, sort: SortKey) {
	try {
		storage?.setItem(STORAGE_KEY, sort);
	} catch {
		// Storage can be unavailable (private mode, blocked site data); the view still works.
	}
}
