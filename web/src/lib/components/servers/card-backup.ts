import type { ExportRecord } from '#lib/api/index.js';
import type { BackupIndex } from '#lib/exports/backups.js';

/** Backup line of a server card: loading and errors are never shown as "no backup". */
export type CardBackup =
	{ status: 'loading' } | { status: 'error' } | { status: 'ready'; latest: ExportRecord | null };

export function cardBackup(index: BackupIndex | null | 'error', serverId: string): CardBackup {
	if (index === null) return { status: 'loading' };
	if (index === 'error') return { status: 'error' };
	return { status: 'ready', latest: index.get(serverId) ?? null };
}
