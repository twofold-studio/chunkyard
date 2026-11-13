import { getChangelog, getVersion, isAbortError, type Changelog } from '#lib/api/index.js';

/** A version that may be displayed. `null` means the badge stays hidden. */
export interface ShownVersion {
	version: string;
	channel: string | null;
}

// Per page load: the badge mounts in both the auth and app shells, so remember answers
// instead of refetching on every navigation between them.
let versionCache: ShownVersion | null | undefined;
let changelogCache: Changelog | undefined;

/**
 * Resolves the version to show, or `null` when the feature is disabled, the response is
 * malformed, or the request failed. Failures are not cached so a later mount can retry;
 * aborts are rethrown.
 */
export async function loadVersion(signal?: AbortSignal): Promise<ShownVersion | null> {
	if (versionCache !== undefined) return versionCache;
	try {
		const info: unknown = await getVersion({ signal });
		versionCache = parseVersion(info);
		return versionCache;
	} catch (error) {
		if (isAbortError(error)) throw error;
		return null;
	}
}

function parseVersion(info: unknown): ShownVersion | null {
	if (typeof info !== 'object' || info === null) return null;
	const { enabled, version, channel } = info as Record<string, unknown>;
	if (enabled !== true || typeof version !== 'string' || !version.trim()) return null;
	return { version: version.trim(), channel: typeof channel === 'string' ? channel : null };
}

/** Fetches the changelog once; errors (including aborts) propagate and are not cached. */
export async function loadChangelog(signal?: AbortSignal): Promise<Changelog> {
	if (changelogCache) return changelogCache;
	const body: unknown = await getChangelog({ signal });
	const markdown = (body as { markdown?: unknown } | null)?.markdown;
	if (typeof markdown !== 'string') throw new Error('The changelog response was malformed.');
	const version = (body as { version?: unknown }).version;
	changelogCache = { version: typeof version === 'string' ? version : '', markdown };
	return changelogCache;
}

/** Short label for a non-release channel, e.g. `dev` for development builds. */
export function channelHint(channel: string | null): string | null {
	if (!channel) return null;
	const normalized = channel.toLowerCase();
	if (normalized === 'stable' || normalized === 'release') return null;
	return normalized === 'development' ? 'dev' : normalized;
}

/** Test hook: forget cached answers. */
export function resetVersionCache() {
	versionCache = undefined;
	changelogCache = undefined;
}
