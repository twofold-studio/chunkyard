import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerGrid from './server-grid.svelte';
import type { ExportRecord, Job, ServerView } from '#lib/api/index.js';
import { metricsHub } from '#lib/servers/metrics-hub.svelte.js';

// Running servers show live usage; keep it off the network here (covered by card-usage tests).
beforeAll(() =>
	metricsHub.configure({
		createSocket: () => ({
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
			close() {}
		})
	})
);
afterAll(() => metricsHub.configure({}));
import { BackupOperations } from '#lib/exports/backup-operations.svelte.js';

const server = (extra: Partial<ServerView>): ServerView => ({
	id: 'srv-1',
	name: 'Survival',
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'eclipse-temurin:21-jre',
	port: 25565,
	memoryMinMb: 1024,
	memoryMaxMb: 4096,
	cpus: 2,
	acceptEula: true,
	directory: '/data/servers/srv-1',
	status: { state: 'running', containerId: 'abc', exitCode: null, oomKilled: false },
	software: null,
	launch: null,
	...extra
});

const props = (servers: ServerView[]) => ({
	servers,
	createHref: '/servers/new'
});

describe('ServerGrid', () => {
	it('shows only the create tile when there are no servers', async () => {
		render(ServerGrid, props([]));
		const items = page.getByRole('listitem');
		await expect.element(items.first()).toHaveTextContent('Create server');
		expect(items.elements()).toHaveLength(1);
		await expect
			.element(page.getByRole('link', { name: /Create server/ }))
			.toHaveAttribute('href', '/servers/new');
	});

	it('keeps the create tile in the first slot and summarizes each server', async () => {
		render(
			ServerGrid,
			props([
				server({
					id: 'paper',
					name: 'Paper box',
					port: 25566,
					software: { type: 'paper', version: '1.21.1' },
					launch: {
						path: 'paper.jar',
						version: '1.21.4',
						build: '232',
						javaMajor: 21,
						checksum: 'ab'
					}
				}),
				server({
					id: 'vanilla',
					name: 'Fresh vanilla',
					port: 25567,
					cpus: 1,
					memoryMaxMb: 2048,
					status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
					software: { type: 'vanilla', version: '1.20.1' },
					launch: null,
					acceptEula: false
				}),
				server({ id: 'manual', name: 'Manual JAR', port: 25570 })
			])
		);
		const items = page.getByRole('listitem');
		expect(items.elements()).toHaveLength(4);
		await expect.element(items.first()).toHaveTextContent('Create server');
		await expect.element(items.nth(0).getByRole('link')).toHaveAttribute('href', '/servers/new');

		const paper = items.nth(1);
		await expect.element(paper.getByRole('link')).toHaveAttribute('href', '/servers/paper');
		await expect.element(paper).toHaveTextContent('Paper box');
		await expect.element(paper).toHaveTextContent('Container running');
		await expect.element(paper).toHaveTextContent('Paper');
		// Persisted launch version wins over the requested one.
		await expect.element(paper).toHaveTextContent('1.21.4');
		await expect.element(paper).not.toHaveTextContent('1.21.1');
		await expect.element(paper).toHaveTextContent('4 GiB');
		await expect.element(paper).toHaveTextContent('2 CPUs');
		await expect.element(paper).toHaveTextContent('Port 25566');

		const vanilla = items.nth(2);
		await expect.element(vanilla).toHaveTextContent('Stopped');
		await expect.element(vanilla).toHaveTextContent('Vanilla');
		await expect.element(vanilla).toHaveTextContent('1.20.1');
		await expect.element(vanilla).toHaveTextContent('Not installed');
		await expect.element(vanilla).toHaveTextContent('1 CPU');
		await expect.element(vanilla).toHaveTextContent('Port 25567');

		const manual = items.nth(3);
		await expect.element(manual).toHaveTextContent('Custom');
		await expect.element(manual).toHaveTextContent('Unknown version');
		await expect.element(manual).toHaveTextContent('Port 25570');
	});
	describe('backups and archived servers', () => {
		const now = Date.parse('2026-11-14T12:00:00Z');
		const backup = (serverId: string, createdAt: string): ExportRecord => ({
			id: `b-${serverId}`,
			serverId,
			serverName: serverId,
			scope: 'all',
			destination: 's3',
			createdAt,
			size: 1,
			sha256: 'a'.repeat(64),
			fileName: 'x.tar.gz',
			objectKey: 'x'
		});
		const archived = server({
			id: 'arch',
			name: 'Old world',
			port: 25580,
			status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
			software: { type: 'paper', version: '1.21.1' },
			archive: { exportId: 'b-arch', archivedAt: '2026-11-13T00:00:00Z' }
		});
		const local = server({ id: 'local', name: 'Live' });

		it('shows local vs archived state and the newest full S3 backup age', async () => {
			const onRestore = vi.fn();
			render(ServerGrid, {
				...props([local, archived]),
				backups: new Map([['arch', backup('arch', '2026-11-11T12:00:00Z')]]),
				onRestore,
				now
			});
			const items = page.getByRole('listitem');
			await expect.element(items.first()).toHaveTextContent('Create server');
			const live = items.nth(1);
			await expect.element(live).toHaveTextContent('Container running');
			await expect.element(live).toHaveTextContent('No full S3 backup');
			expect(live.getByRole('button').elements()).toHaveLength(0);

			const arch = items.nth(2);
			await expect.element(arch).toHaveTextContent('Archived');
			await expect.element(arch).not.toHaveTextContent('Stopped');
			await expect.element(arch).toHaveTextContent('Full S3 backup 3 d ago');
			// Resource metadata and the port stay visible.
			await expect.element(arch).toHaveTextContent('Paper');
			await expect.element(arch).toHaveTextContent('Port 25580');
			await expect.element(arch.getByRole('link')).toHaveAttribute('href', '/servers/arch');
			const restore = arch.getByRole('button', { name: 'Restore Old world' });
			// No interactive control is nested inside the card link.
			expect(restore.element().closest('a')).toBeNull();
			await restore.click();
			expect(onRestore).toHaveBeenCalledWith(archived);
		});

		it('never presents a loading or failed catalog as "no backup"', async () => {
			const first = render(ServerGrid, { ...props([local]), backups: null, now });
			await expect.element(page.getByTestId('backup-age')).toHaveTextContent('Checking backups');
			first.unmount();
			render(ServerGrid, { ...props([local]), backups: 'error', now });
			await expect.element(page.getByTestId('backup-age')).toHaveTextContent('Backups unavailable');
			expect(page.getByText('No full S3 backup').elements()).toHaveLength(0);
		});

		it('shows restore progress and failures from the shared tracker', async () => {
			const operations = new BackupOperations();
			const running: Job = {
				id: 'r1',
				kind: 'server.restore',
				serverId: 'arch',
				state: 'running',
				progress: null,
				message: null,
				error: null,
				result: null,
				createdBy: null,
				createdAt: '',
				startedAt: null,
				finishedAt: null,
				work: { stage: 'fetch_archive', completedBytes: 10, totalBytes: 100, completedStages: [] }
			};
			operations.jobs.set('arch', running);
			const screen = render(ServerGrid, {
				...props([archived]),
				backups: new Map(),
				operations,
				onRestore: vi.fn(),
				now
			});
			await expect.element(page.getByRole('button', { name: 'Restore Old world' })).toBeDisabled();
			await expect.element(page.getByTestId('work-progress')).toBeVisible();
			operations.jobs.set('arch', {
				...running,
				state: 'failed',
				error: { code: 'exports.restore_conflict', detail: 'exists' }
			});
			operations.errors.set('arch', { code: 'exports.restore_conflict', detail: 'exists' });
			await expect
				.element(page.getByRole('alert'))
				.toHaveTextContent('Restore would overwrite files');
			await expect.element(page.getByRole('button', { name: 'Restore Old world' })).toBeEnabled();
			screen.unmount();
			operations.destroy();
		});
	});
});
