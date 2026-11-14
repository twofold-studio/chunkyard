import { describe, expect, it } from 'vitest';
import type { ExportRecord, ServerView } from '#lib/api/index.js';
import {
	canArchiveTo,
	canRestoreFrom,
	formatAge,
	fullS3Backups,
	groupBackups,
	isArchived,
	latestFullS3ByServer,
	restoreAllowed
} from './backups.js';

const rec = (id: string, extra: Partial<ExportRecord> = {}): ExportRecord => ({
	id,
	serverId: 's1',
	serverName: 'Old name',
	scope: 'all',
	destination: 's3',
	createdAt: '2026-11-10T00:00:00Z',
	size: 10,
	sha256: 'a'.repeat(64),
	fileName: `${id}.tar.gz`,
	objectKey: null,
	...extra
});

const srv = (id: string, extra: Partial<ServerView> = {}) =>
	({ id, name: `Server ${id}`, ...extra }) as ServerView;

describe('backups', () => {
	it('treats missing or null archive as local', () => {
		expect(isArchived(srv('a'))).toBe(false);
		expect(isArchived(srv('a', { archive: null }))).toBe(false);
		expect(isArchived(srv('a', { archive: { exportId: 'e', archivedAt: 'x' } }))).toBe(true);
	});

	it('only offers restore for full archives and removal for full S3 archives', () => {
		expect(canRestoreFrom(rec('a', { scope: 'world' }))).toBe(false);
		expect(canRestoreFrom(rec('a', { scope: 'selected' }))).toBe(false);
		expect(canRestoreFrom(rec('a', { destination: 'local' }))).toBe(true);
		expect(canArchiveTo(rec('a', { destination: 'local' }))).toBe(false);
		expect(canArchiveTo(rec('a'))).toBe(true);
		expect(restoreAllowed('local')).toBe(false);
		expect(restoreAllowed('unknown')).toBe(false);
		expect(restoreAllowed('archived')).toBe(true);
		expect(restoreAllowed('removed')).toBe(true);
	});

	it('finds the newest full S3 backup per server', () => {
		const list = [
			rec('old', { createdAt: '2026-11-01T00:00:00Z' }),
			rec('new', { createdAt: '2026-11-12T00:00:00Z' }),
			rec('world', { scope: 'world', createdAt: '2026-11-13T00:00:00Z' }),
			rec('local', { destination: 'local', createdAt: '2026-11-13T00:00:00Z' })
		];
		expect(latestFullS3ByServer(list).get('s1')?.id).toBe('new');
		expect(fullS3Backups(list, 's1').map((e) => e.id)).toEqual(['new', 'old']);
		expect(latestFullS3ByServer([rec('w', { scope: 'world' })]).has('s1')).toBe(false);
	});

	it('formats ages compactly', () => {
		const now = Date.parse('2026-11-14T12:00:00Z');
		expect(formatAge('2026-11-14T11:59:50Z', now)).toBe('just now');
		expect(formatAge('2026-11-14T11:30:00Z', now)).toBe('30 min ago');
		expect(formatAge('2026-11-14T07:00:00Z', now)).toBe('5 h ago');
		expect(formatAge('2026-11-11T12:00:00Z', now)).toBe('3 d ago');
		expect(formatAge('2026-07-01T12:00:00Z', now)).toBe('4 mo ago');
		expect(formatAge('nope', now)).toBe('unknown age');
	});

	it('groups by server with local, archived, removed and unknown states', () => {
		const list = [
			rec('a1', { createdAt: '2026-11-12T00:00:00Z' }),
			rec('a0', { createdAt: '2026-11-11T00:00:00Z' }),
			rec('b1', { serverId: 's2', scope: 'world', createdAt: '2026-11-13T00:00:00Z' }),
			rec('c1', { serverId: 'gone', serverName: 'Gone', createdAt: '2026-11-09T00:00:00Z' })
		];
		const servers = [
			srv('s1', { archive: { exportId: 'a0', archivedAt: '2026-11-12T01:00:00Z' } }),
			srv('s2', { archive: null })
		];
		const groups = groupBackups(list, servers);
		expect(groups.map((g) => g.serverId)).toEqual(['s2', 's1', 'gone']);
		const [local, archived, removed] = groups;
		expect(local.state).toBe('local');
		// A world-only archive never yields a restore candidate.
		expect(local.restoreFrom).toBeNull();
		expect(archived.state).toBe('archived');
		expect(archived.name).toBe('Server s1');
		// The pinned restore point wins over a newer full archive.
		expect(archived.pinned?.id).toBe('a0');
		expect(archived.restoreFrom?.id).toBe('a0');
		expect(removed.state).toBe('removed');
		expect(removed.name).toBe('Gone');
		expect(removed.restoreFrom?.id).toBe('c1');
		expect(groupBackups(list, null).every((g) => g.state === 'unknown')).toBe(true);
	});
});
