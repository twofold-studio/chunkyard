import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerActions from './server-actions.svelte';

describe('ServerActions', () => {
	it('only offers start for a stopped server', async () => {
		render(ServerActions, {
			serverState: 'stopped',
			busy: false,
			pending: null,
			onAction: vi.fn()
		});
		await expect.element(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
		await expect.element(page.getByRole('button', { name: 'Stop' })).toBeDisabled();
		await expect.element(page.getByRole('button', { name: 'Kill' })).toBeDisabled();
	});

	it('disables every action while a job is running', async () => {
		render(ServerActions, {
			serverState: 'running',
			busy: true,
			pending: 'stop',
			onAction: vi.fn()
		});
		for (const name of ['Start', 'Stop', 'Restart', 'Kill']) {
			await expect
				.element(page.getByRole('button', { name: new RegExp(`(^|\\s)${name}$`) }))
				.toBeDisabled();
		}
	});

	it('requires confirmation before force killing', async () => {
		const onAction = vi.fn();
		render(ServerActions, { serverState: 'running', busy: false, pending: null, onAction });
		await page.getByRole('button', { name: 'Kill' }).click();
		await expect.element(page.getByRole('alertdialog')).toBeVisible();
		expect(onAction).not.toHaveBeenCalled();
		await page.getByRole('button', { name: 'Cancel' }).click();
		expect(onAction).not.toHaveBeenCalled();

		await page.getByRole('button', { name: 'Kill' }).click();
		await page.getByRole('button', { name: 'Force kill' }).click();
		expect(onAction).toHaveBeenCalledExactlyOnceWith('kill');
	});

	it('sends stop directly without confirmation', async () => {
		const onAction = vi.fn();
		render(ServerActions, { serverState: 'running', busy: false, pending: null, onAction });
		await page.getByRole('button', { name: 'Stop' }).click();
		expect(onAction).toHaveBeenCalledWith('stop');
	});
});
