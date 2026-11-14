import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerInstallPanel from './server-install-panel.svelte';
import type { Job } from '#lib/api/index.js';

const software = { type: 'paper' as const, version: '1.21.1', build: '130' };

describe('ServerInstallPanel', () => {
	it('offers install for a not-installed server', async () => {
		const onInstall = vi.fn();
		render(ServerInstallPanel, { software, job: null, working: false, onInstall });
		await expect.element(page.getByText('Paper')).toBeVisible();
		await expect.element(page.getByText(/1\.21\.1 build 130/)).toBeVisible();
		await page.getByRole('button', { name: 'Install' }).click();
		expect(onInstall).toHaveBeenCalledOnce();
	});

	it('shows indeterminate progress without a percentage', async () => {
		render(ServerInstallPanel, {
			software,
			job: {
				id: 'j',
				kind: 'server.install',
				serverId: 's',
				state: 'running',
				progress: 0.42,
				message: 'Downloading',
				error: null,
				result: null,
				createdBy: null,
				createdAt: '',
				startedAt: null,
				finishedAt: null
			},
			working: true,
			onInstall: vi.fn()
		});
		await expect.element(page.getByText('Installing…')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Install' })).toBeDisabled();
		expect(document.body.textContent).not.toMatch(/\d+\s*%/);
	});

	it('offers a retry after a failure', async () => {
		render(ServerInstallPanel, {
			software,
			job: null,
			working: false,
			error: { code: 'software.download_failed', detail: 'Checksum mismatch.' },
			onInstall: vi.fn()
		});
		await expect.element(page.getByText('Software download failed')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Retry install' })).toBeEnabled();
	});
});

describe('ServerInstallPanel stage progress', () => {
	const running = (extra: Partial<Job> = {}): Job => ({
		id: 'j',
		kind: 'server.install',
		serverId: 's',
		state: 'running',
		progress: null,
		message: null,
		error: null,
		result: null,
		createdBy: null,
		createdAt: '',
		startedAt: null,
		finishedAt: null,
		work: {
			stage: 'download',
			completedBytes: 10 * 1024 * 1024,
			totalBytes: 100 * 1024 * 1024,
			completedStages: ['resolve']
		},
		...extra
	});

	it('shows the current download step with its own percent', async () => {
		render(ServerInstallPanel, { software, job: running(), working: true, onInstall: vi.fn() });
		await expect.element(page.getByText('Installing…')).toBeVisible();
		await expect.element(page.getByText('Downloading')).toBeVisible();
		await expect.element(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
		await expect.element(page.getByTestId('work-history')).toHaveTextContent('Resolve');
	});

	it('keeps the last observed step after a failure and hides it once installed', async () => {
		const failure = { code: 'software.download_failed', detail: 'Checksum mismatch.' };
		const view = render(ServerInstallPanel, {
			software,
			job: running({ state: 'failed', error: failure }),
			working: false,
			error: failure,
			onInstall: vi.fn()
		});
		await expect.element(page.getByText('Failed during downloading')).toBeVisible();
		expect(page.getByRole('progressbar').elements()).toHaveLength(0);
		await view.rerender({
			job: running({ state: 'succeeded', progress: 1 }),
			error: null,
			installed: true
		});
		await expect.element(page.getByText(/^Installed\./)).toBeVisible();
		expect(page.getByTestId('work-progress').elements()).toHaveLength(0);
	});

	it('names a resolved pack instead of its IDs, with an ID fallback', async () => {
		const pack = { type: 'curseforge' as const, projectId: 101, fileId: 555 };
		const view = render(ServerInstallPanel, {
			software: pack,
			job: null,
			working: false,
			packName: 'All the Mods 10',
			releaseName: 'ATM10 2.41'
		});
		await expect.element(page.getByText(/All the Mods 10 · ATM10 2\.41/)).toBeVisible();
		expect(document.body.textContent).not.toContain('project 101');
		await view.rerender({ packName: null, releaseName: null });
		await expect.element(page.getByText(/project 101 · release 555/)).toBeVisible();
	});
});

describe('ServerInstallPanel advanced options', () => {
	const pack = { type: 'curseforge' as const, projectId: 101, fileId: 555 };
	const failure = { code: 'software.pack_unsupported', detail: 'No server loader found.' };

	it('keeps advanced options out of normal installs', async () => {
		const onInstall = vi.fn();
		render(ServerInstallPanel, { software, job: null, working: false, onInstall });
		await expect
			.element(page.getByRole('button', { name: /Advanced options/ }))
			.not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Install' }).click();
		expect(onInstall).toHaveBeenCalledWith(null);
	});

	it('retries a pack with detection when nothing is overridden', async () => {
		const onInstall = vi.fn();
		render(ServerInstallPanel, {
			software: pack,
			job: null,
			working: false,
			error: failure,
			onInstall
		});
		await expect.element(page.getByText('Server pack not supported')).toBeVisible();
		await expect.element(page.getByLabelText('Minecraft version')).not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Retry install' }).click();
		expect(onInstall).toHaveBeenCalledWith(null);
	});

	it('sends only the overrides that were set', async () => {
		const onInstall = vi.fn();
		render(ServerInstallPanel, {
			software: pack,
			job: null,
			working: false,
			error: failure,
			onInstall
		});
		await page.getByRole('button', { name: /Advanced options/ }).click();
		await page.getByLabelText('Minecraft version').fill('1.20.1');
		await page.getByLabelText('Java version').fill('17');
		await page.getByRole('switch', { name: 'Set launch target' }).click();
		await page.getByRole('radio', { name: /Bash script/ }).click();
		await page.getByLabelText('Script path').fill('startserver.sh');
		await expect.element(page.getByText('Overrides set')).toBeVisible();
		await page.getByRole('button', { name: 'Retry install' }).click();
		expect(onInstall).toHaveBeenCalledWith({
			minecraftVersion: '1.20.1',
			javaMajor: 17,
			launch: { mode: 'script', path: 'startserver.sh', javaMajor: 17, jvmArgs: [], args: [] }
		});
	});

	it('blocks an invalid override and explains why', async () => {
		const onInstall = vi.fn();
		render(ServerInstallPanel, { software: pack, job: null, working: false, onInstall });
		await page.getByRole('button', { name: /Advanced options/ }).click();
		await page.getByLabelText('Loader version').fill('47.3.0');
		await page.getByRole('button', { name: 'Install' }).click();
		await expect
			.element(page.getByText('Choose the loader this version belongs to.'))
			.toBeVisible();
		expect(onInstall).not.toHaveBeenCalled();
	});

	it('explains disabled third-party downloads', async () => {
		render(ServerInstallPanel, {
			software: pack,
			job: null,
			working: false,
			error: { code: 'software.download_unavailable', detail: 'Distribution disabled.' },
			onInstall: vi.fn()
		});
		await expect.element(page.getByText('Download not allowed')).toBeVisible();
		await expect.element(page.getByText(/disabled third-party downloads/)).toBeVisible();
	});
});
