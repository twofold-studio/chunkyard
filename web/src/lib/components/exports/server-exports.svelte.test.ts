import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerExports from './server-exports.svelte';
import type { Job } from '#lib/api/index.js';
import { exportSelection } from '#lib/exports/export-selection.svelte.js';

type Reply = { status: number; body?: unknown };
let calls: { path: string; method: string; body?: unknown }[];
let replies: Record<string, Reply[]>;
const reply = (method: string, path: string, ...queue: Reply[]) =>
	(replies[`${method} ${path}`] = queue);

const storage = (configured: boolean) => ({
	configured,
	endpoint: configured ? 'http://10.0.0.5:9000' : '',
	region: configured ? 'us-east-1' : '',
	bucket: configured ? 'mc' : '',
	prefix: '',
	accessKeyId: configured ? 'AKIA' : '',
	hasSecret: configured
});

const archive = (id: string, serverId = 'srv-1', destination = 'local') => ({
	id,
	serverId,
	serverName: 'Survival',
	scope: 'world',
	destination,
	createdAt: '2026-11-14T10:00:00Z',
	size: 2048,
	sha256: 'abcdef0123456789'.repeat(4),
	fileName: `survival-${id}.tar.gz`,
	objectKey: destination === 's3' ? `survival-${id}.tar.gz` : null
});

const job = (state: Job['state'], extra: Partial<Job> = {}): Job => ({
	id: 'job-x',
	kind: 'server.export',
	serverId: 'srv-1',
	state,
	progress: null,
	message: null,
	error: null,
	result: null,
	createdBy: null,
	createdAt: '',
	startedAt: null,
	finishedAt: null,
	...extra
});

const DEFAULT_AUTOMATION = {
	recovery: { autoStart: false, restartOnCrash: false, maxAttempts: 3, retryDelaySeconds: 30 },
	backup: { enabled: false, intervalMinutes: 1440, keepLast: null },
	historyEnabled: true,
	desiredRunning: false,
	restartAttempts: 0,
	nextRetryAt: null,
	stableSince: null,
	nextBackupAt: null,
	lastBackupAt: null,
	lastBackupJob: null,
	lastBackupExportId: null,
	lastBackupResult: null,
	lastBackupError: null,
	lastHistoryAt: null
};

beforeEach(() => {
	calls = [];
	replies = {};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (path: string, init: RequestInit) => {
			const method = init.method ?? 'GET';
			calls.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
			// The scheduled-backup section reads the (default, disabled) automation state.
			if (
				method === 'GET' &&
				path === '/api/v1/servers/srv-1/automation' &&
				!replies[`GET ${path}`]
			)
				return new Response(JSON.stringify(DEFAULT_AUTOMATION), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			const next = replies[`${method} ${path}`]?.shift();
			if (!next) throw new Error(`unexpected request ${method} ${path}`);
			if (next.status === 204) return new Response(null, { status: 204 });
			return new Response(JSON.stringify(next.body ?? {}), {
				status: next.status,
				headers: {
					'content-type': next.status >= 400 ? 'application/problem+json' : 'application/json'
				}
			});
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	exportSelection.clear('srv-1');
});

const exportButton = () => page.getByRole('button', { name: 'Export', exact: true });

describe('ServerExports', () => {
	it('lists only this server’s archives and requires a stopped server', async () => {
		reply('GET', '/api/v1/storage', { status: 200, body: storage(false) });
		reply('GET', '/api/v1/exports', {
			status: 200,
			body: { items: [archive('a'), archive('b', 'srv-2')] }
		});
		render(ServerExports, { serverId: 'srv-1', serverState: 'running' });
		await expect.element(page.getByText('survival-a.tar.gz')).toBeVisible();
		await expect.element(page.getByText('survival-b.tar.gz')).not.toBeInTheDocument();
		await expect.element(page.getByText('Stop the server to export')).toBeVisible();
		await expect.element(exportButton()).toBeDisabled();
		await expect.element(page.getByRole('radio', { name: 'S3' })).toBeDisabled();
	});

	it('exports selected paths to S3 and shows the verified archive', async () => {
		const created = archive('new', 'srv-1', 's3');
		reply('GET', '/api/v1/storage', { status: 200, body: storage(true) });
		reply('GET', '/api/v1/exports', { status: 200, body: { items: [] } });
		reply('POST', '/api/v1/servers/srv-1/exports', { status: 202, body: { job: job('queued') } });
		reply(
			'GET',
			'/api/v1/jobs/job-x',
			{ status: 200, body: job('running') },
			{ status: 200, body: job('succeeded', { result: created }) }
		);
		render(ServerExports, { serverId: 'srv-1', serverState: 'stopped', jobIntervalMs: 5 });

		await page.getByRole('radio', { name: 'Selected paths' }).click();
		await exportButton().click();
		await expect.element(page.getByText('Enter at least one path.')).toBeVisible();

		await page.getByRole('textbox').fill('world\n/plugins/\nworld');
		await page.getByRole('radio', { name: 'S3' }).click();
		await exportButton().click();
		await expect.element(page.getByRole('alertdialog')).toHaveTextContent('To S3 bucket mc');
		await page.getByRole('button', { name: 'Start export' }).click();

		await expect.element(page.getByText('Export verified', { exact: true })).toBeVisible();
		await expect.element(page.getByRole('listitem')).toHaveTextContent('survival-new.tar.gz');
		const post = calls.find((c) => c.method === 'POST');
		expect(post?.body).toEqual({
			scope: 'selected',
			destination: 's3',
			paths: ['world', 'plugins']
		});
	});

	it('reports a failed export job without touching files', async () => {
		reply('GET', '/api/v1/storage', { status: 200, body: storage(false) });
		reply('GET', '/api/v1/exports', { status: 200, body: { items: [] } });
		reply('POST', '/api/v1/servers/srv-1/exports', {
			status: 202,
			body: { job: job('failed', { error: { code: 'exports.limit', detail: 'Too big.' } }) }
		});
		render(ServerExports, { serverId: 'srv-1', serverState: 'stopped', jobIntervalMs: 5 });
		await exportButton().click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Export too large');
		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('Server files were not changed.');
	});

	it('deletes an archive after confirmation', async () => {
		reply('GET', '/api/v1/storage', { status: 200, body: storage(false) });
		reply('GET', '/api/v1/exports', { status: 200, body: { items: [archive('a')] } });
		reply('DELETE', '/api/v1/exports/a', { status: 204 });
		render(ServerExports, { serverId: 'srv-1', serverState: 'running' });
		await page.getByRole('button', { name: 'Delete survival-a.tar.gz' }).click();
		await expect.element(page.getByRole('alertdialog')).toHaveTextContent('not affected');
		await page.getByRole('button', { name: 'Delete archive' }).click();
		await expect.element(page.getByText('survival-a.tar.gz')).not.toBeInTheDocument();
		expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/exports/a')).toBe(true);
	});

	it('links downloads through the authenticated backend route', async () => {
		reply('GET', '/api/v1/storage', { status: 200, body: storage(true) });
		reply('GET', '/api/v1/exports', {
			status: 200,
			body: { items: [archive('s', 'srv-1', 's3')] }
		});
		render(ServerExports, { serverId: 'srv-1', serverState: 'stopped' });
		await expect
			.element(page.getByRole('link', { name: 'Download survival-s.tar.gz' }))
			.toHaveAttribute('href', '/api/v1/exports/s/download');
	});

	describe('Files selection', () => {
		it('confirms the exact selected paths and destination, then clears them', async () => {
			exportSelection.add('srv-1', [
				{ path: 'world', kind: 'directory' },
				{ path: 'ops.json', kind: 'file' }
			]);
			reply('GET', '/api/v1/storage', { status: 200, body: storage(false) });
			reply('GET', '/api/v1/exports', { status: 200, body: { items: [] } });
			reply('POST', '/api/v1/servers/srv-1/exports', {
				status: 202,
				body: { job: job('queued') }
			});
			reply('GET', '/api/v1/jobs/job-x', {
				status: 200,
				body: job('succeeded', { result: archive('sel') })
			});
			render(ServerExports, { serverId: 'srv-1', serverState: 'stopped', jobIntervalMs: 5 });

			// A pending selection opens the selected scope without typing.
			await expect
				.element(page.getByRole('radio', { name: 'Selected paths' }))
				.toHaveAttribute('aria-checked', 'true');
			await expect.element(page.getByTestId('selected-count')).toHaveTextContent('2 selected');
			await page.getByRole('textbox').fill('plugins/LuckPerms');
			await exportButton().click();

			const dialog = page.getByRole('alertdialog');
			await expect.element(dialog).toHaveTextContent('Export 3 paths?');
			await expect.element(dialog).toHaveTextContent('To the manager host');
			const listed = [...dialog.element().querySelectorAll('li')].map((li) => li.textContent);
			expect(listed).toEqual(['ops.json', 'world', 'plugins/LuckPerms']);
			expect(calls.some((c) => c.method === 'POST')).toBe(false);

			await page.getByRole('button', { name: 'Start export' }).click();
			await expect.element(page.getByText('Export verified', { exact: true })).toBeVisible();
			expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
				scope: 'selected',
				destination: 'local',
				paths: ['ops.json', 'world', 'plugins/LuckPerms']
			});
			expect(exportSelection.count('srv-1')).toBe(0);
		});

		it('cancelling the confirmation sends nothing and keeps the selection', async () => {
			exportSelection.add('srv-1', [{ path: 'world', kind: 'directory' }]);
			reply('GET', '/api/v1/storage', { status: 200, body: storage(false) });
			reply('GET', '/api/v1/exports', { status: 200, body: { items: [] } });
			render(ServerExports, { serverId: 'srv-1', serverState: 'stopped' });
			await exportButton().click();
			await page.getByRole('button', { name: 'Cancel' }).click();
			await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
			expect(calls.some((c) => c.method === 'POST')).toBe(false);
			expect(exportSelection.paths('srv-1')).toEqual(['world']);
		});

		it('blocks exporting a selection while the server runs', async () => {
			exportSelection.add('srv-1', [{ path: 'world', kind: 'directory' }]);
			reply('GET', '/api/v1/storage', { status: 200, body: storage(false) });
			reply('GET', '/api/v1/exports', { status: 200, body: { items: [] } });
			render(ServerExports, { serverId: 'srv-1', serverState: 'running' });
			await expect.element(page.getByText('Stop the server to export')).toBeVisible();
			await expect.element(exportButton()).toBeDisabled();
		});

		it('removes individual paths and offers a way back to Files', async () => {
			exportSelection.add('srv-1', [
				{ path: 'world', kind: 'directory' },
				{ path: 'ops.json', kind: 'file' }
			]);
			reply('GET', '/api/v1/storage', { status: 200, body: storage(false) });
			reply('GET', '/api/v1/exports', { status: 200, body: { items: [] } });
			const onChooseFiles = vi.fn();
			render(ServerExports, { serverId: 'srv-1', serverState: 'stopped', onChooseFiles });
			await page.getByRole('button', { name: 'Remove world from the selection' }).click();
			expect(exportSelection.paths('srv-1')).toEqual(['ops.json']);
			await page.getByRole('button', { name: 'Clear selection' }).click();
			await page.getByRole('button', { name: 'Choose in Files' }).click();
			expect(onChooseFiles).toHaveBeenCalledOnce();
		});
	});
});

describe('ServerExports recovered export', () => {
	it('shows a recovered export as running, blocks a new one and reloads archives when done', async () => {
		reply(
			'GET',
			'/api/v1/storage',
			{ status: 200, body: storage(false) },
			{ status: 200, body: storage(false) }
		);
		reply(
			'GET',
			'/api/v1/exports',
			{ status: 200, body: { items: [] } },
			{ status: 200, body: { items: [archive('a1')] } }
		);
		const running = job('running', { id: 'job-r', message: 'Compressing world' });
		const view = render(ServerExports, {
			serverId: 'srv-1',
			serverState: 'stopped',
			busy: true,
			recoveredJob: running,
			archivesVersion: 0
		});
		await expect.element(page.getByText('Compressing world')).toBeVisible();
		await expect.element(exportButton()).toBeDisabled();
		const details = page.getByRole('link', { name: /Started earlier/ });
		expect(details.element().getAttribute('href')).toMatch(/\/activity\/job-r$/);
		expect(calls.some((c) => c.method === 'POST')).toBe(false);

		await view.rerender({
			busy: false,
			recoveredJob: job('succeeded', { id: 'job-r' }),
			archivesVersion: 1
		});
		await expect.element(page.getByText('survival-a1.tar.gz')).toBeVisible();
		expect(calls.filter((c) => c.path === '/api/v1/exports')).toHaveLength(2);
		expect(calls.some((c) => c.method === 'POST')).toBe(false);
	});

	it('shows recovered export upload and read-back verification as separate steps', async () => {
		reply('GET', '/api/v1/storage', { status: 200, body: storage(true) });
		reply('GET', '/api/v1/exports', { status: 200, body: { items: [] } });
		const MiB = 1024 * 1024;
		const upload = job('running', {
			id: 'job-u',
			work: {
				stage: 'upload',
				completedBytes: 19 * MiB,
				totalBytes: 95 * MiB,
				completedStages: ['scan', 'compress']
			}
		});
		const view = render(ServerExports, {
			serverId: 'srv-1',
			serverState: 'stopped',
			busy: true,
			recoveredJob: upload,
			archivesVersion: 0
		});
		await expect.element(page.getByText('Uploading to storage')).toBeVisible();
		await expect.element(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');
		await view.rerender({
			recoveredJob: job('running', {
				id: 'job-u',
				work: {
					stage: 'verify_upload',
					completedBytes: null,
					totalBytes: 95 * MiB,
					completedStages: ['scan', 'compress', 'upload']
				}
			})
		});
		await expect.element(page.getByText('Verifying upload (checksum read-back)')).toBeVisible();
		await expect.element(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
		// Rendering progress adds no job polling or mutations; the page owns job tracking.
		expect(calls.every((c) => c.method === 'GET' && !c.path.includes('/jobs'))).toBe(true);
	});

	it('shows the step a recovered export stopped at', async () => {
		reply('GET', '/api/v1/storage', { status: 200, body: storage(true) });
		reply('GET', '/api/v1/exports', { status: 200, body: { items: [] } });
		const failure = { code: 'job.interrupted', detail: 'The manager restarted during the export.' };
		render(ServerExports, {
			serverId: 'srv-1',
			serverState: 'stopped',
			recoveredJob: job('failed', {
				id: 'job-f',
				error: failure,
				work: { stage: 'upload', completedBytes: 1, totalBytes: 2, completedStages: ['scan'] }
			}),
			recoveredError: failure
		});
		await expect.element(page.getByText('Interrupted during uploading to storage')).toBeVisible();
		expect(page.getByRole('progressbar').elements()).toHaveLength(0);
	});

	it('shows a recovered failure with its Activity link', async () => {
		reply('GET', '/api/v1/storage', { status: 200, body: storage(false) });
		reply('GET', '/api/v1/exports', { status: 200, body: { items: [] } });
		const failure = { code: 'job.interrupted', detail: 'The manager restarted during the export.' };
		render(ServerExports, {
			serverId: 'srv-1',
			serverState: 'stopped',
			recoveredJob: job('failed', { id: 'job-f', error: failure }),
			recoveredError: failure
		});
		await expect.element(page.getByText('The manager restarted during the export.')).toBeVisible();
		const link = page.getByRole('link', { name: 'Job details in Activity' });
		expect(link.element().getAttribute('href')).toMatch(/\/activity\/job-f$/);
	});
	describe('archive and restore', () => {
		const full = (id: string, destination = 's3', createdAt = '2026-11-14T10:00:00Z') => ({
			...archive(id, 'srv-1', destination),
			scope: 'all',
			createdAt
		});

		it('removes local files only after choosing a full S3 backup and acknowledging data loss', async () => {
			reply('GET', '/api/v1/storage', { status: 200, body: storage(true) });
			reply('GET', '/api/v1/exports', {
				status: 200,
				body: {
					items: [
						full('new', 's3', '2026-11-14T10:00:00Z'),
						full('old', 's3', '2026-11-01T10:00:00Z'),
						full('local-full', 'local'),
						{ ...archive('world-s3', 'srv-1', 's3') }
					]
				}
			});
			const onRemoveLocal = vi.fn();
			render(ServerExports, {
				serverId: 'srv-1',
				serverName: 'Survival',
				serverState: 'stopped',
				onRemoveLocal
			});
			const select = page.getByRole('combobox', { name: 'Backup' });
			await expect.element(select).toBeVisible();
			// Only full S3 backups are offered.
			expect(select.element().querySelectorAll('option')).toHaveLength(2);
			await select.selectOptions('old');
			await page.getByRole('button', { name: 'Remove local files…' }).click();
			const confirm = page.getByRole('button', { name: 'Remove local files', exact: true });
			await expect.element(confirm).toBeDisabled();
			await page.getByRole('checkbox').click();
			await confirm.click();
			expect(onRemoveLocal).toHaveBeenCalledWith('old');
			// The component never submits by itself: the page controller owns the request.
			expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
		});

		it('blocks removal while running, with unsaved edits or without a full S3 backup', async () => {
			reply(
				'GET',
				'/api/v1/storage',
				{ status: 200, body: storage(true) },
				{ status: 200, body: storage(true) }
			);
			reply('GET', '/api/v1/exports', { status: 200, body: { items: [full('a')] } });
			const screen = render(ServerExports, {
				serverId: 'srv-1',
				serverState: 'running',
				onRemoveLocal: vi.fn()
			});
			await expect
				.element(page.getByText('Stop the server first. Nothing is stopped for you.'))
				.toBeVisible();
			await expect
				.element(page.getByRole('button', { name: 'Remove local files…' }))
				.toBeDisabled();
			screen.unmount();
			reply('GET', '/api/v1/exports', { status: 200, body: { items: [full('a')] } });
			render(ServerExports, {
				serverId: 'srv-1',
				serverState: 'stopped',
				removeBlocked: 'Save or discard the unsaved file edits in Files first.',
				onRemoveLocal: vi.fn()
			});
			await expect
				.element(page.getByText('Save or discard the unsaved file edits in Files first.'))
				.toBeVisible();
			await expect
				.element(page.getByRole('button', { name: 'Remove local files…' }))
				.toBeDisabled();
		});

		it('explains that a full S3 export is needed when none exists', async () => {
			reply('GET', '/api/v1/storage', { status: 200, body: storage(true) });
			reply('GET', '/api/v1/exports', { status: 200, body: { items: [full('l', 'local')] } });
			render(ServerExports, { serverId: 'srv-1', serverState: 'stopped', onRemoveLocal: vi.fn() });
			await expect.element(page.getByText(/Needs a/)).toBeVisible();
			expect(page.getByRole('button', { name: 'Remove local files…' }).elements()).toHaveLength(0);
		});

		it('hides new exports while archived, protects the pinned backup and restores full archives only', async () => {
			reply('GET', '/api/v1/storage', { status: 200, body: storage(true) });
			reply('GET', '/api/v1/exports', {
				status: 200,
				body: { items: [full('pinned'), full('other', 'local'), archive('world')] }
			});
			const onRestore = vi.fn();
			render(ServerExports, {
				serverId: 'srv-1',
				serverName: 'Survival',
				serverState: 'stopped',
				archive: { exportId: 'pinned', archivedAt: '2026-11-14T11:00:00Z' },
				onRemoveLocal: vi.fn(),
				onRestore
			});
			await expect.element(page.getByText('survival-pinned.tar.gz')).toBeVisible();
			expect(exportButton().elements()).toHaveLength(0);
			expect(page.getByRole('button', { name: 'Remove local files…' }).elements()).toHaveLength(0);
			await expect.element(page.getByText('Restore point', { exact: true })).toBeVisible();
			expect(
				page.getByRole('button', { name: 'Delete survival-pinned.tar.gz' }).elements()
			).toHaveLength(0);
			await expect
				.element(page.getByRole('button', { name: 'Delete survival-other.tar.gz' }))
				.toBeVisible();
			// World archives are download-only.
			expect(
				page.getByRole('button', { name: 'Restore from survival-world.tar.gz' }).elements()
			).toHaveLength(0);
			await page.getByRole('button', { name: 'Restore from survival-pinned.tar.gz' }).click();
			await expect.element(page.getByRole('alertdialog')).toHaveTextContent('Restore Survival?');
			expect(onRestore).not.toHaveBeenCalled();
			await page.getByRole('button', { name: 'Restore', exact: true }).click();
			expect(onRestore).toHaveBeenCalledWith('pinned');
			expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
		});
	});
});
