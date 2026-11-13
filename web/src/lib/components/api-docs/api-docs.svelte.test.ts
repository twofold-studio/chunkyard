import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ApiDocsViewer from './api-docs-viewer.svelte';
import ApiDocsLoader from './api-docs-loader.svelte';
import { fixture } from './openapi.fixture';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('ApiDocsViewer', () => {
	it('lists grouped operations from the document', async () => {
		render(ApiDocsViewer, { doc: fixture });
		await expect.element(page.getByRole('heading', { name: 'servers' })).toBeVisible();
		await expect.element(page.getByText('/api/v1/servers/{id}/metrics')).toBeVisible();
		await expect.element(page.getByText('Liveness probe')).toBeVisible();
		await expect.element(page.getByText('4 endpoints')).toBeVisible();
		// Tags without operations are not shown.
		expect(page.getByRole('heading', { name: 'unused' }).elements()).toHaveLength(0);
	});

	it('filters operations as you type and clears with Escape', async () => {
		render(ApiDocsViewer, { doc: fixture });
		const search = page.getByLabelText('Search endpoints');
		await search.fill('metrics');
		await expect.element(page.getByText('1 of 4 endpoints')).toBeVisible();
		expect(page.getByText('Sign in').elements()).toHaveLength(0);
		await userEvent.keyboard('{Escape}');
		await expect.element(search).toHaveValue('');
		await expect.element(page.getByText('Sign in')).toBeVisible();
	});

	it('focuses search with the / shortcut', async () => {
		render(ApiDocsViewer, { doc: fixture });
		await expect.element(page.getByText('4 endpoints')).toBeVisible();
		(document.activeElement as HTMLElement | null)?.blur();
		await userEvent.keyboard('/');
		await expect.element(page.getByLabelText('Search endpoints')).toHaveFocus();
	});

	it('shows parameters, request body and responses when an operation is expanded', async () => {
		render(ApiDocsViewer, { doc: fixture });
		await page.getByText('/api/v1/servers/{id}/metrics').click();
		const op = page.getByRole('group').filter({ hasText: 'getServerMetrics' });
		await expect
			.element(op.getByText('CPU and memory samples for a running server.'))
			.toBeVisible();
		await expect.element(op.getByText('window')).toBeVisible();
		await expect.element(op.getByText('min 1')).toBeVisible();
		await expect.element(op.getByRole('link', { name: 'Sample' })).toBeVisible();

		await page.getByText('/api/v1/auth/login').click();
		await expect.element(page.getByText('None (public)')).toBeVisible();
		await expect.element(page.getByText('application/problem+json')).toBeVisible();
	});

	it('opens a referenced schema from a type link', async () => {
		render(ApiDocsViewer, { doc: fixture });
		await page.getByText('/api/v1/servers/{id}/metrics').click();
		await page.getByRole('link', { name: 'Sample' }).click();
		const schema = document.getElementById('schema-sample') as HTMLDetailsElement;
		await vi.waitFor(() => expect(schema.open).toBe(true));
		await expect.element(page.getByText('cpuPercent', { exact: true })).toBeVisible();
	});

	it('expands and collapses all visible operations', async () => {
		render(ApiDocsViewer, { doc: fixture });
		await page.getByRole('button', { name: 'Expand all' }).click();
		await vi.waitFor(() =>
			expect(
				[...document.querySelectorAll('details[id^="op-"]')].every(
					(d) => (d as HTMLDetailsElement).open
				)
			).toBe(true)
		);
		await page.getByRole('button', { name: 'Collapse all' }).click();
		await vi.waitFor(() =>
			expect(document.querySelectorAll('details[id^="op-"][open]')).toHaveLength(0)
		);
	});
});

describe('ApiDocsLoader', () => {
	it('fetches the same-origin document with the session cookie', async () => {
		const fetch = vi.fn().mockResolvedValue(json(fixture));
		vi.stubGlobal('fetch', fetch);
		const onLoad = vi.fn();
		render(ApiDocsLoader, { onLoad });
		await expect.element(page.getByText('Chunkyard API')).toBeVisible();
		expect(fetch.mock.calls[0][0]).toBe('/api/v1/openapi.json');
		expect(fetch.mock.calls[0][1].credentials).toBe('same-origin');
		expect(onLoad).toHaveBeenCalledWith(fixture);
	});

	it('shows the backend error and retries', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(json({ code: 'docker.failed', detail: 'boom' }, 500))
			.mockResolvedValueOnce(json(fixture));
		vi.stubGlobal('fetch', fetch);
		render(ApiDocsLoader, {});
		await expect.element(page.getByRole('alert')).toHaveTextContent('boom');
		await page.getByRole('button', { name: 'Retry' }).click();
		await expect.element(page.getByText('Chunkyard API')).toBeVisible();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('rejects a payload that is not an OpenAPI document', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ hello: 'world' })));
		render(ApiDocsLoader, {});
		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('The backend did not return an OpenAPI 3 document.');
	});
});
