import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import VersionBadge from './version-badge.svelte';
import { resetVersionCache } from '#lib/version.js';

const ENABLED = { enabled: true, version: '0.1.0', channel: 'development' };
const DISABLED = { enabled: false, version: null, channel: null };
const MARKDOWN = [
	'# Changelog',
	'',
	'## Unreleased',
	'',
	'### Added',
	'',
	'- Web UI: show the `v0.1.0` badge.',
	'- Raw <img src=x onerror="window.__pwned=1"> stays text.'
].join('\n');

function json(body: unknown, status = 200, type = 'application/json') {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
}

/** Routes stubbed fetch calls by path; each handler may be swapped per test. */
function stubApi(handlers: Record<string, (init: RequestInit) => Promise<Response> | Response>) {
	const fetch = vi.fn((path: string, init: RequestInit) => {
		const handler = handlers[path];
		if (!handler) throw new Error(`unexpected fetch ${path}`);
		return Promise.resolve(handler(init));
	});
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

const paths = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map((c) => c[0]);

beforeEach(() => resetVersionCache());
afterEach(() => vi.unstubAllGlobals());

describe('VersionBadge', () => {
	it('stays hidden and never requests the changelog when disabled', async () => {
		const fetch = stubApi({ '/api/v1/system/version': () => json(DISABLED) });
		render(VersionBadge);
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
		await new Promise((r) => setTimeout(r, 20));
		expect(page.getByRole('button').query()).toBeNull();
		expect(paths(fetch)).toEqual(['/api/v1/system/version']);
	});

	it('hides quietly when the version request fails or is malformed', async () => {
		stubApi({ '/api/v1/system/version': () => json({ docker: {} }) });
		const first = render(VersionBadge);
		await new Promise((r) => setTimeout(r, 20));
		expect(page.getByRole('button').query()).toBeNull();
		first.unmount();

		stubApi({ '/api/v1/system/version': () => Promise.reject(new TypeError('offline')) });
		render(VersionBadge);
		await new Promise((r) => setTimeout(r, 20));
		expect(page.getByRole('button').query()).toBeNull();
	});

	it('fetches the changelog only when opened and renders it as safe text', async () => {
		const fetch = stubApi({
			'/api/v1/system/version': () => json(ENABLED),
			'/api/v1/system/changelog': () => json({ version: '0.1.0', markdown: MARKDOWN })
		});
		render(VersionBadge);
		const badge = page.getByRole('button', { name: /Chunkyard version 0\.1\.0.*View changelog/ });
		await expect.element(badge).toHaveTextContent(/^\s*v0\.1\.0\s*·\s*dev\s*$/);
		expect(paths(fetch)).toEqual(['/api/v1/system/version']);

		await badge.click();
		const dialog = page.getByRole('dialog', { name: 'Changelog' });
		await expect.element(dialog.getByRole('heading', { name: 'Unreleased' })).toBeVisible();
		await expect.element(dialog.getByRole('heading', { name: 'Added' })).toBeVisible();
		await expect
			.element(dialog.getByRole('listitem').first())
			.toHaveTextContent('Web UI: show the v0.1.0 badge.');
		await expect.element(dialog.getByText('v0.1.0', { exact: true })).toBeVisible();
		await expect
			.element(dialog.getByText(/Raw <img src=x onerror="window.__pwned=1"> stays text\./))
			.toBeVisible();
		expect(dialog.element().querySelector('img')).toBeNull();
		// The document's own "# Changelog" heading is folded into the dialog title.
		expect(dialog.getByRole('heading', { name: 'Changelog' }).elements()).toHaveLength(1);
		expect(paths(fetch)).toEqual(['/api/v1/system/version', '/api/v1/system/changelog']);
	});

	it('shows a retry after a failed changelog request', async () => {
		let fail = true;
		const fetch = stubApi({
			'/api/v1/system/version': () => json(ENABLED),
			'/api/v1/system/changelog': () =>
				fail
					? json(
							{ code: 'version.disabled', detail: 'Version information is disabled.' },
							404,
							'application/problem+json'
						)
					: json({ version: '0.1.0', markdown: MARKDOWN })
		});
		render(VersionBadge);
		await page.getByRole('button', { name: /View changelog/ }).click();
		await expect.element(page.getByText('Version information disabled')).toBeVisible();

		fail = false;
		await page.getByRole('button', { name: 'Retry' }).click();
		await expect.element(page.getByRole('heading', { name: 'Unreleased' })).toBeVisible();
		expect(paths(fetch).filter((p) => p === '/api/v1/system/changelog')).toHaveLength(2);
	});

	it('aborts in-flight requests on unmount', async () => {
		const signals: AbortSignal[] = [];
		stubApi({
			'/api/v1/system/version': (init) => {
				signals.push(init.signal!);
				return new Promise<Response>(() => {});
			}
		});
		const view = render(VersionBadge);
		await vi.waitFor(() => expect(signals).toHaveLength(1));
		view.unmount();
		expect(signals[0].aborted).toBe(true);
	});

	it('aborts a pending changelog request when the dialog closes', async () => {
		const signals: AbortSignal[] = [];
		stubApi({
			'/api/v1/system/version': () => json(ENABLED),
			'/api/v1/system/changelog': (init) => {
				signals.push(init.signal!);
				return new Promise<Response>(() => {});
			}
		});
		render(VersionBadge);
		await page.getByRole('button', { name: /View changelog/ }).click();
		await expect.element(page.getByText('Loading changelog…')).toBeVisible();
		await page.getByRole('button', { name: 'Close' }).click();
		await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true));
	});
});
