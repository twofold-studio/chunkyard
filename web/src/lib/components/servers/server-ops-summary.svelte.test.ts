import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerOpsSummary, { type OpsSummaryApi } from './server-ops-summary.svelte';
import { ApiError, type ExportRecord, type Job, type PropertiesDocument } from '#lib/api/index.js';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const record = (id: string, extra: Partial<ExportRecord> = {}): ExportRecord => ({
	id,
	serverId: 'srv-1',
	serverName: 'Survival',
	scope: 'all',
	destination: 's3',
	createdAt: '2026-11-11T12:00:00Z',
	size: 1,
	sha256: 'f'.repeat(64),
	fileName: `${id}.tar.gz`,
	objectKey: id,
	...extra
});
const job = (id: string, kind: string, state: Job['state'], finishedAt: string | null): Job => ({
	id,
	kind,
	serverId: 'srv-1',
	state,
	progress: null,
	message: null,
	error: null,
	result: null,
	createdBy: null,
	createdAt: '2026-11-14T11:00:00Z',
	startedAt: null,
	finishedAt
});
const doc = (extra: Partial<PropertiesDocument> = {}): PropertiesDocument => ({
	content: '',
	etag: 'e',
	version: 5,
	appliedVersion: 4,
	restartRequired: true,
	status: { state: 'running', containerId: null, exitCode: null, oomKilled: false },
	updatedAt: '2026-11-14T10:00:00Z',
	...extra
});

function api(overrides: Partial<OpsSummaryApi> = {}) {
	return {
		exports: vi.fn(async () => [
			record('old', { createdAt: '2026-11-01T12:00:00Z' }),
			record('new'),
			record('partial', { scope: 'selected', createdAt: '2026-11-14T11:00:00Z' }),
			record('other', { serverId: 'srv-2', createdAt: '2026-11-14T11:30:00Z' })
		]),
		jobs: vi.fn(async () => [
			job('j1', 'server.start', 'succeeded', '2026-11-14T11:58:00Z'),
			job('j2', 'export.create', 'failed', '2026-11-14T10:00:00Z')
		]),
		properties: vi.fn(async () => doc()),
		...overrides
	};
}

describe('ServerOpsSummary', () => {
	it('shows the newest full backup, recent jobs and the restart-needed properties version', async () => {
		const stub = api();
		render(ServerOpsSummary, { serverId: 'srv-1', running: true, now: NOW, api: stub });
		await expect
			.element(page.getByTestId('ops-backup'))
			.toHaveTextContent('Full S3 backup 3 d ago');
		await expect
			.element(page.getByTestId('ops-properties'))
			.toHaveTextContent(/Running v4 · v5 saved\s*Restart to apply/);
		const activity = page.getByTestId('ops-activity');
		await expect.element(activity).toHaveTextContent(/Start server\s*2 min ago/);
		await expect.element(activity.getByRole('listitem')).toHaveLength(2);
		expect(stub.jobs).toHaveBeenCalledWith('srv-1', expect.any(AbortSignal));
	});

	it('reports missing or failing parts honestly, without numbers it does not have', async () => {
		render(ServerOpsSummary, {
			serverId: 'srv-1',
			running: false,
			now: NOW,
			api: api({
				exports: async () => [record('partial', { scope: 'selected' })],
				jobs: async () => {
					throw new ApiError(503, 'storage.unavailable', 'down');
				},
				properties: async () => doc({ appliedVersion: null, restartRequired: false })
			})
		});
		await expect.element(page.getByTestId('ops-backup')).toHaveTextContent('No full S3 backup yet');
		await expect
			.element(page.getByTestId('ops-activity'))
			.toHaveTextContent('Activity unavailable');
		await expect
			.element(page.getByTestId('ops-properties'))
			.toHaveTextContent('Next start uses v5');
	});

	it('loads once, re-reads only on a new refresh key, and aborts stale requests', async () => {
		const signals: AbortSignal[] = [];
		const stub = api({
			properties: vi.fn(async (_id: string, signal: AbortSignal) => {
				signals.push(signal);
				return doc();
			})
		});
		const view = render(ServerOpsSummary, {
			serverId: 'srv-1',
			running: true,
			refreshKey: 'running:false',
			now: NOW,
			api: stub
		});
		await expect.element(page.getByTestId('ops-properties')).toHaveTextContent('Running v4');
		await new Promise((r) => setTimeout(r, 50));
		expect(stub.properties).toHaveBeenCalledTimes(1);
		await view.rerender({ refreshKey: 'running:true' });
		await vi.waitFor(() => expect(stub.properties).toHaveBeenCalledTimes(2));
		expect(signals[0].aborted).toBe(true);
		await view.rerender({ serverId: 'srv-2' });
		await vi.waitFor(() => expect(stub.properties).toHaveBeenCalledTimes(3));
		expect(stub.properties).toHaveBeenLastCalledWith('srv-2', expect.any(AbortSignal));
		view.unmount();
		expect(signals.at(-1)?.aborted).toBe(true);
	});

	it('links to Exports, Properties and Activity', async () => {
		const onOpenExports = vi.fn();
		const onOpenActivity = vi.fn();
		const onOpenProperties = vi.fn();
		render(ServerOpsSummary, {
			serverId: 'srv-1',
			running: true,
			now: NOW,
			api: api(),
			onOpenExports,
			onOpenActivity,
			onOpenProperties
		});
		await page.getByRole('button', { name: 'Exports' }).click();
		await page.getByRole('button', { name: 'Activity' }).click();
		await page.getByRole('button', { name: 'Properties' }).click();
		expect(
			[onOpenExports, onOpenActivity, onOpenProperties].every((f) => f.mock.calls.length === 1)
		).toBe(true);
	});
});
