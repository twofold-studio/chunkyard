import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerArchivedPanel from './server-archived-panel.svelte';
import ServerSettings from './server-settings.svelte';
import type { ExportRecord, ServerView } from '#lib/api/index.js';

const now = Date.parse('2026-11-14T12:00:00Z');
const server = {
	autoJava: false,
	launchOverride: null,
	publishIp: null,
	id: 'srv-1',
	name: 'Survival',
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'img',
	port: 25570,
	memoryMinMb: 1024,
	memoryMaxMb: 4096,
	cpus: 2,
	acceptEula: true,
	directory: '/d',
	status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
	software: null,
	launch: null,
	icon: null,
	archive: { exportId: 'pin', archivedAt: '2026-11-13T12:00:00Z' }
} satisfies ServerView;
const pinned: ExportRecord = {
	id: 'pin',
	serverId: 'srv-1',
	serverName: 'Survival',
	scope: 'all',
	destination: 's3',
	createdAt: '2026-11-12T12:00:00Z',
	size: 2048,
	sha256: 'f'.repeat(64),
	fileName: 'survival-full.tar.gz',
	objectKey: 'k'
};

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
	fetchSpy = vi.fn(async () => new Response('{}', { status: 500 }));
	vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe('ServerArchivedPanel', () => {
	it('describes the restore point and offers Restore without fetching anything', async () => {
		const onRestore = vi.fn();
		render(ServerArchivedPanel, {
			server,
			pinned,
			working: false,
			onRestore,
			onOpenExports: vi.fn(),
			now
		});
		const panel = page.getByTestId('archived-panel');
		await expect.element(panel).toHaveTextContent('Local files were removed 1 d ago');
		await expect.element(panel).toHaveTextContent('Full instance · S3');
		await expect.element(panel).toHaveTextContent('survival-full.tar.gz');
		await expect.element(panel).toHaveTextContent('EULA accepted');
		await page.getByRole('button', { name: 'Restore' }).click();
		expect(onRestore).toHaveBeenCalledOnce();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('separates loading and catalog errors from a missing restore point', async () => {
		const first = render(ServerArchivedPanel, {
			server,
			pinned: undefined,
			working: false,
			onRestore: vi.fn(),
			onOpenExports: vi.fn(),
			now
		});
		await expect.element(page.getByText('Loading backup details…')).toBeVisible();
		first.unmount();
		const onRetryCatalog = vi.fn();
		render(ServerArchivedPanel, {
			server,
			pinned: undefined,
			catalogError: { code: 'exports.storage', detail: 'down' },
			onRetryCatalog,
			working: false,
			onRestore: vi.fn(),
			onOpenExports: vi.fn(),
			now
		});
		await expect.element(page.getByText('Storage unavailable')).toBeVisible();
		// Restore still works from the pinned ID.
		await expect.element(page.getByRole('button', { name: 'Restore' })).toBeEnabled();
		await page.getByRole('button', { name: 'Retry', exact: true }).click();
		expect(onRetryCatalog).toHaveBeenCalledOnce();
	});

	it('shows a failed restore as retryable', async () => {
		render(ServerArchivedPanel, {
			server,
			pinned,
			working: false,
			error: { code: 'exports.restore_conflict', detail: 'exists' },
			onRestore: vi.fn(),
			onOpenExports: vi.fn(),
			now
		});
		await expect.element(page.getByText('Restore would overwrite files')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Retry restore' })).toBeEnabled();
	});
});

describe('ServerSettings while archived', () => {
	it('keeps only display metadata and never offers EULA or hosting changes', async () => {
		render(ServerSettings, {
			server: { ...server, acceptEula: false },
			busy: false,
			archived: true,
			onRequestEula: vi.fn(),
			onRevokeEula: vi.fn(),
			onServerUpdated: vi.fn(),
			onOpenProperties: vi.fn()
		});
		await expect.element(page.getByRole('region', { name: 'Display' })).toBeVisible();
		expect(page.getByRole('region', { name: 'Hosting' }).elements()).toHaveLength(0);
		expect(page.getByRole('switch').elements()).toHaveLength(0);
		expect(page.getByRole('button', { name: 'Review EULA' }).elements()).toHaveLength(0);
		expect(page.getByText('Minecraft settings').elements()).toHaveLength(0);
	});
});
