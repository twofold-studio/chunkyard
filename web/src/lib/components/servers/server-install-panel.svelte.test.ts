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
