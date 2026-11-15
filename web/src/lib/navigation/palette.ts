import { resolve } from '$app/paths';
import type { ServerView } from '#lib/api/index.js';
import { matchesQuery, softwareFilterLabel, softwareKey } from '#lib/servers/list-view.js';

/** A navigation-only palette entry: selecting it never mutates anything. */
export interface Destination {
	id: string;
	group: 'Go to' | 'Servers';
	label: string;
	detail?: string;
	href: string;
	keywords: string;
}

export const SERVER_TABS = [
	['overview', 'Overview'],
	['console', 'Console'],
	['properties', 'Properties'],
	['files', 'Files'],
	['exports', 'Exports'],
	['activity', 'Activity'],
	['settings', 'Settings']
] as const;

export function appDestinations(): Destination[] {
	const app = (id: string, label: string, href: string, keywords = ''): Destination => ({
		id: `app:${id}`,
		group: 'Go to',
		label,
		href,
		keywords: `${label} ${keywords}`.toLowerCase()
	});
	return [
		app('servers', 'Servers', resolve('servers'), 'list home'),
		app('new', 'New server', resolve('servers/new'), 'create add install'),
		app('activity', 'Activity', resolve('activity'), 'jobs history'),
		app('exports', 'Storage & exports', resolve('exports'), 'backup archive disk'),
		app('integrations', 'Integrations', resolve('integrations'), 'api keys tokens mcp claude'),
		app('api', 'API reference', resolve('api-docs'), 'rest docs')
	];
}

/** Deep link to a server tab; the ID is percent-encoded so it stays one path segment. */
export function serverHref(id: string, tab: string): string {
	const base = resolve(`servers/${encodeURIComponent(id)}`);
	return tab === 'overview' ? base : `${base}?tab=${tab}`;
}

export function serverDestinations(server: ServerView): Destination[] {
	const software = softwareFilterLabel(softwareKey(server));
	return SERVER_TABS.map(([tab, label]) => ({
		id: `server:${server.id}:${tab}`,
		group: 'Servers' as const,
		label: `${server.name} — ${label}`,
		detail: `${software} · port ${server.port}`,
		href: serverHref(server.id, tab),
		keywords: label.toLowerCase()
	}));
}

/**
 * App destinations match on label/keywords; server tabs match when each query term
 * hits the server (name, software, version, port) or the tab name.
 */
export function searchDestinations(
	servers: readonly ServerView[],
	query: string,
	limit = 40
): Destination[] {
	const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
	const apps = appDestinations().filter((d) => terms.every((t) => d.keywords.includes(t)));
	const results: Destination[] = [...apps];
	for (const server of servers) {
		for (const dest of serverDestinations(server)) {
			if (terms.every((t) => dest.keywords.includes(t) || matchesQuery(server, t))) {
				// Without a query, list only each server's Overview to keep the list short.
				if (!terms.length && !dest.id.endsWith(':overview')) continue;
				results.push(dest);
			}
		}
	}
	return results.slice(0, limit);
}

/**
 * Short-lived in-memory cache for the palette's server list, keyed by session so a
 * different sign-in never sees another session's records. Late responses after
 * `cancel()` or a session change are discarded.
 */
export function createServerSource(
	load: (signal: AbortSignal) => Promise<ServerView[]>,
	ttlMs = 15_000,
	now: () => number = Date.now
) {
	let cache: { key: string; at: number; items: ServerView[] } | null = null;
	let controller: AbortController | null = null;

	return {
		cached(key: string): ServerView[] | null {
			return cache && cache.key === key && now() - cache.at < ttlMs ? cache.items : null;
		},
		async fetch(key: string): Promise<ServerView[] | null> {
			controller?.abort();
			const current = new AbortController();
			controller = current;
			try {
				const items = await load(current.signal);
				if (current.signal.aborted) return null;
				cache = { key, at: now(), items };
				return items;
			} catch (error) {
				if (current.signal.aborted) return null;
				throw error;
			} finally {
				if (controller === current) controller = null;
			}
		},
		cancel() {
			controller?.abort();
			controller = null;
		},
		clear() {
			this.cancel();
			cache = null;
		}
	};
}
