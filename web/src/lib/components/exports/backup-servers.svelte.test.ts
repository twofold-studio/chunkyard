import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import BackupServers from './backup-servers.svelte';
import type { ExportRecord, ServerView } from '#lib/api/index.js';
import { BackupOperations } from '#lib/exports/backup-operations.svelte.js';
import { groupBackups } from '#lib/exports/backups.js';

const now = Date.parse('2026-11-14T12:00:00Z');
const rec = (id: string, serverId: string, extra: Partial<ExportRecord> = {}): ExportRecord => ({
	id,
	serverId,
	serverName: `${serverId} at export`,
	scope: 'all',
	destination: 's3',
	createdAt: '2026-11-12T12:00:00Z',
	size: 1024,
	sha256: 'a'.repeat(64),
	fileName: `${id}.tar.gz`,
	objectKey: null,
	...extra
});
const srv = (id: string, extra: Partial<ServerView> = {}) =>
	({ id, name: `Server ${id}`, icon: null, software: null, ...extra }) as ServerView;

const exports = [
	rec('l1', 'local'),
	rec('a1', 'arch', { createdAt: '2026-11-10T12:00:00Z' }),
	rec('w1', 'world-only', { scope: 'world', serverName: 'Worlds' }),
	rec('g1', 'gone', { serverName: 'Gone server', destination: 'local' })
];
const servers = [
	srv('local'),
	srv('arch', { archive: { exportId: 'a1', archivedAt: '2026-11-11T00:00:00Z' } }),
	srv('world-only')
];

describe('BackupServers', () => {
	it('groups by server with honest state, latest age and restore eligibility', async () => {
		const onRestore = vi.fn();
		const operations = new BackupOperations();
		render(BackupServers, {
			groups: groupBackups(exports, servers),
			operations,
			onRestore,
			ondeleted: vi.fn(),
			now
		});
		const rows = page.getByTestId('backup-group');
		expect(rows.elements()).toHaveLength(4);

		const local = page.getByTestId('backup-group').filter({ hasText: 'Server local' });
		await expect.element(local).toHaveTextContent('Local');
		await expect.element(local).toHaveTextContent('Latest 2 d ago');
		await expect.element(local).toHaveTextContent('Full instance · S3');
		// A local instance is never overwritten.
		expect(local.getByRole('button', { name: /Restore/ }).elements()).toHaveLength(0);

		const arch = page.getByTestId('backup-group').filter({ hasText: 'Server arch' });
		await expect.element(arch).toHaveTextContent('Archived');
		await expect.element(arch).toHaveTextContent('Restore point 4 d ago');
		await arch.getByRole('button', { name: 'Restore Server arch' }).click();
		expect(onRestore).toHaveBeenCalledWith(
			expect.objectContaining({ serverId: 'arch' }),
			exports[1]
		);

		const worlds = page.getByTestId('backup-group').filter({ hasText: 'Server world-only' });
		await expect.element(worlds).toHaveTextContent('No full backup · download only');
		expect(worlds.getByRole('button', { name: /Restore/ }).elements()).toHaveLength(0);

		const gone = page.getByTestId('backup-group').filter({ hasText: 'Gone server' });
		await expect.element(gone).toHaveTextContent('Removed from manager');
		expect(gone.getByRole('link').elements()).toHaveLength(0);
		await expect.element(gone.getByRole('button', { name: 'Restore Gone server' })).toBeEnabled();
		operations.destroy();
	});

	it('expands a server to its archives and protects the pinned restore point', async () => {
		const operations = new BackupOperations();
		render(BackupServers, {
			groups: groupBackups([...exports, rec('a0', 'arch', { scope: 'selected' })], servers),
			operations,
			onRestore: vi.fn(),
			ondeleted: vi.fn(),
			now
		});
		const arch = page.getByTestId('backup-group').filter({ hasText: 'Server arch' });
		const toggle = arch.getByRole('button', { name: /2 backups/ });
		await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
		await toggle.click();
		await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
		expect(page.getByRole('button', { name: 'Delete a1.tar.gz' }).elements()).toHaveLength(0);
		await expect.element(page.getByRole('button', { name: 'Delete a0.tar.gz' })).toBeVisible();
		await expect
			.element(page.getByRole('button', { name: 'Restore from a1.tar.gz' }))
			.toBeVisible();
		expect(page.getByRole('button', { name: 'Restore from a0.tar.gz' }).elements()).toHaveLength(0);
		operations.destroy();
	});

	it('marks every server unknown without offering restore when the inventory failed', async () => {
		const operations = new BackupOperations();
		render(BackupServers, {
			groups: groupBackups(exports, null),
			operations,
			onRestore: vi.fn(),
			ondeleted: vi.fn(),
			now
		});
		await expect
			.element(page.getByTestId('backup-group').first())
			.toHaveTextContent('State unknown');
		expect(page.getByRole('button', { name: /^Restore / }).elements()).toHaveLength(0);
		operations.destroy();
	});
});
