import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerInstallPanel from './server-install-panel.svelte';

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
