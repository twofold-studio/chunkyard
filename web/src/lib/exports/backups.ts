/**
 * Pure helpers for archived instances and full-backup restoration. They only interpret the
 * existing `GET /api/v1/servers` and `GET /api/v1/exports` responses; nothing here fetches.
 */
import type { ExportRecord, ServerView } from '#lib/api/index.js';
import { DESTINATION_LABELS, SCOPE_LABELS } from './exports.js';

/** Missing/`null` `archive` (older backends and records) means a local instance. */
export function isArchived(server: Pick<ServerView, 'archive'> | null | undefined): boolean {
	return !!server?.archive && typeof server.archive.exportId === 'string';
}

/** Only full-instance archives can recreate an instance; world/selected ones are download-only. */
export function canRestoreFrom(record: Pick<ExportRecord, 'scope'>): boolean {
	return record.scope === 'all';
}

/** Local files may only be removed against a full archive held in S3. */
export function canArchiveTo(record: Pick<ExportRecord, 'scope' | 'destination'>): boolean {
	return record.scope === 'all' && record.destination === 's3';
}

const newestFirst = (a: ExportRecord, b: ExportRecord) => b.createdAt.localeCompare(a.createdAt);

/** Full S3 archives of one server, newest first. */
export function fullS3Backups(exports: readonly ExportRecord[], serverId: string): ExportRecord[] {
	return exports.filter((e) => e.serverId === serverId && canArchiveTo(e)).sort(newestFirst);
}

/** Newest full S3 backup per server ID; an absent key means none in a loaded catalog. */
export type BackupIndex = Map<string, ExportRecord>;

export function latestFullS3ByServer(exports: readonly ExportRecord[]): BackupIndex {
	const index: BackupIndex = new Map();
	for (const record of exports) {
		if (!canArchiveTo(record)) continue;
		const current = index.get(record.serverId);
		if (!current || record.createdAt > current.createdAt) index.set(record.serverId, record);
	}
	return index;
}

/** Compact age such as `just now`, `12 min ago`, `5 h ago`, `3 d ago`, `4 mo ago`. */
export function formatAge(iso: string | null | undefined, now: number): string {
	const ms = iso ? Date.parse(iso) : NaN;
	if (Number.isNaN(ms)) return 'unknown age';
	const s = Math.max(0, now - ms) / 1000;
	if (s < 45) return 'just now';
	if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
	if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
	const days = Math.floor(s / 86_400);
	if (days < 60) return `${days} d ago`;
	if (days < 730) return `${Math.floor(days / 30)} mo ago`;
	return `${Math.floor(days / 365)} y ago`;
}

/** e.g. "Full instance · S3". */
export function backupKind(record: Pick<ExportRecord, 'scope' | 'destination'>): string {
	return `${SCOPE_LABELS[record.scope]} · ${DESTINATION_LABELS[record.destination]}`;
}

/**
 * What the manager knows about a backed-up server: `local` and `archived` records exist,
 * `removed` means no record in the current inventory (host files may still exist), and
 * `unknown` means the inventory could not be loaded.
 */
export type InstanceState = 'local' | 'archived' | 'removed' | 'unknown';

export const INSTANCE_STATE_LABELS: Record<InstanceState, string> = {
	local: 'Local',
	archived: 'Archived',
	removed: 'Removed from manager',
	unknown: 'State unknown'
};

export interface BackupGroup {
	serverId: string;
	/** Current record name, else the name at the newest export. */
	name: string;
	state: InstanceState;
	server: ServerView | null;
	/** All archives of this server, newest first. */
	items: ExportRecord[];
	latest: ExportRecord;
	/** Pinned restore point of an archived server, when present in the catalog. */
	pinned: ExportRecord | null;
	/** Archive a Restore action uses: the pinned point, else the newest full archive. */
	restoreFrom: ExportRecord | null;
}

export function instanceState(
	serverId: string,
	servers: readonly ServerView[] | null
): { state: InstanceState; server: ServerView | null } {
	if (servers === null) return { state: 'unknown', server: null };
	const server = servers.find((s) => s.id === serverId) ?? null;
	if (!server) return { state: 'removed', server: null };
	return { state: isArchived(server) ? 'archived' : 'local', server };
}

/** True when a full archive may be restored for this state (never over a local instance). */
export function restoreAllowed(state: InstanceState): boolean {
	return state === 'archived' || state === 'removed';
}

/** Groups the catalog by server, newest activity first. `servers === null` = inventory unknown. */
export function groupBackups(
	exports: readonly ExportRecord[],
	servers: readonly ServerView[] | null
): BackupGroup[] {
	const byServer = new Map<string, ExportRecord[]>();
	for (const record of exports) {
		const list = byServer.get(record.serverId);
		if (list) list.push(record);
		else byServer.set(record.serverId, [record]);
	}
	const groups: BackupGroup[] = [];
	for (const [serverId, list] of byServer) {
		const items = [...list].sort(newestFirst);
		const { state, server } = instanceState(serverId, servers);
		const pinnedId = server?.archive?.exportId ?? null;
		const pinned = pinnedId ? (items.find((e) => e.id === pinnedId) ?? null) : null;
		const newestFull = items.find(canRestoreFrom) ?? null;
		groups.push({
			serverId,
			name: server?.name ?? items[0].serverName,
			state,
			server,
			items,
			latest: items[0],
			pinned,
			restoreFrom: pinned ?? newestFull
		});
	}
	return groups.sort((a, b) => newestFirst(a.latest, b.latest));
}
