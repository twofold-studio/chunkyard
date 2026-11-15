import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ApiKeys, { type ApiKeysApi } from './api-keys.svelte';
import { ApiError, type ApiKey } from '#lib/api/index.js';

const key = (id: string, name: string, extra: Partial<ApiKey> = {}): ApiKey => ({
	id,
	name,
	prefix: `cyk_${id}`,
	createdAt: '2026-11-10T10:00:00Z',
	lastUsedAt: null,
	...extra
});

const TOKEN = 'cyk_new1_0123456789abcdefSECRET';

function setup(initial: ApiKey[] = [], overrides: Partial<ApiKeysApi> = {}) {
	const api = {
		list: vi.fn(async () => initial),
		create: vi.fn(async (name: string) => ({ key: key('new1', name), token: TOKEN })),
		revoke: vi.fn(async () => {}),
		...overrides
	};
	render(ApiKeys, { api });
	return api;
}

describe('ApiKeys', () => {
	it('lists only name, prefix and dates, with Never for unused keys', async () => {
		setup([
			key('a1', 'Claude Code', { lastUsedAt: '2026-11-14T08:00:00Z' }),
			key('b2', 'Backup script')
		]);
		const list = page.getByRole('list', { name: 'API keys' });
		await expect.element(list).toHaveTextContent('Claude Code');
		await expect.element(list).toHaveTextContent('cyk_a1…');
		await expect.element(list.getByRole('listitem').nth(1)).toHaveTextContent(/Last used\s*Never/);
	});

	it('shows the full token once, copies it explicitly and forgets it on close', async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		const log = vi.spyOn(console, 'log');
		const startUrl = location.href;
		try {
			const api = setup();
			await expect.element(page.getByText('No API keys yet.')).toBeVisible();
			await page.getByLabelText('New key name').fill('  Claude Code  ');
			await page.getByRole('button', { name: 'Create key' }).click();
			expect(api.create).toHaveBeenCalledWith('Claude Code');
			const dialog = page.getByRole('dialog', { name: 'Copy your new API key' });
			await expect.element(dialog).toHaveTextContent(TOKEN);
			expect(writeText).not.toHaveBeenCalled();
			await page.getByRole('button', { name: 'Copy API key' }).click();
			expect(writeText).toHaveBeenCalledWith(TOKEN);
			await page.getByRole('button', { name: 'Done' }).click();
			await expect.element(dialog).not.toBeInTheDocument();
			expect(document.body.textContent).not.toContain(TOKEN);
			await expect
				.element(page.getByRole('list', { name: 'API keys' }))
				.toHaveTextContent('cyk_new1…');
			expect(setItem.mock.calls.flat().join(' ')).not.toContain(TOKEN);
			expect(log.mock.calls.flat().join(' ')).not.toContain(TOKEN);
			expect(location.href).toBe(startUrl);
			await expect.element(page.getByLabelText('New key name')).toHaveValue('');
		} finally {
			setItem.mockRestore();
			log.mockRestore();
			vi.unstubAllGlobals();
		}
	});

	it('validates names before creating and shows backend errors', async () => {
		const api = setup([], {
			create: vi.fn(async () => {
				throw new ApiError(409, 'auth.api_key_limit', 'At most 100 keys.');
			})
		});
		await page.getByRole('button', { name: 'Create key' }).click();
		await expect
			.element(page.getByText('Name the integration that will use this key.'))
			.toBeVisible();
		await page.getByLabelText('New key name').fill('é'.repeat(41));
		await page.getByRole('button', { name: 'Create key' }).click();
		await expect.element(page.getByText('Use at most 80 bytes.')).toBeVisible();
		expect(api.create).not.toHaveBeenCalled();
		await page.getByLabelText('New key name').fill('ok');
		await page.getByRole('button', { name: 'Create key' }).click();
		await expect.element(page.getByText('At most 100 keys.')).toBeVisible();
	});

	it('revokes only after confirmation', async () => {
		const api = setup([key('a1', 'Old laptop'), key('b2', 'CI')]);
		await page.getByRole('button', { name: 'Revoke Old laptop' }).click();
		const confirm = page.getByRole('alertdialog', { name: 'Revoke Old laptop?' });
		await expect.element(confirm).toBeVisible();
		await page.getByRole('button', { name: 'Keep key' }).click();
		await expect.element(confirm).not.toBeInTheDocument();
		expect(api.revoke).not.toHaveBeenCalled();

		await page.getByRole('button', { name: 'Revoke Old laptop' }).click();
		await page.getByRole('button', { name: 'Revoke key' }).click();
		expect(api.revoke).toHaveBeenCalledWith('a1');
		await expect.element(page.getByText('Old laptop')).not.toBeInTheDocument();
		await expect.element(page.getByText('CI', { exact: true })).toBeVisible();
	});

	it('offers retry when listing fails', async () => {
		const list = vi
			.fn()
			.mockRejectedValueOnce(new ApiError(503, 'docker.unavailable', 'Down'))
			.mockResolvedValueOnce([key('a1', 'Back')]);
		setup([], { list });
		await page.getByRole('button', { name: 'Retry' }).click();
		await expect.element(page.getByText('Back')).toBeVisible();
		await userEvent.keyboard('{Escape}');
	});
});
