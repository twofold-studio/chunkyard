import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerConsole from './server-console.svelte';

function snapshot(lines: string[]) {
	return new Response(
		JSON.stringify({ items: lines.map((text) => ({ stream: 'stdout', text })) }),
		{
			headers: { 'content-type': 'application/json' }
		}
	);
}

afterEach(() => vi.unstubAllGlobals());

describe('ServerConsole', () => {
	it('replaces the snapshot on refresh instead of appending duplicates', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(snapshot(['line one', 'line two']))
			.mockResolvedValueOnce(snapshot(['line one', 'line two', 'line three']));
		vi.stubGlobal('fetch', fetch);
		render(ServerConsole, { serverId: 's1', running: false });
		const log = page.getByRole('log');
		await expect.element(log).toHaveTextContent('line two');
		await page.getByRole('button', { name: 'Refresh' }).click();
		await expect.element(log).toHaveTextContent('line three');
		expect(log.element().textContent?.match(/line one/g)).toHaveLength(1);
		expect(fetch.mock.calls[0][0]).toBe('/api/v1/servers/s1/console?tail=200');
	});

	it('disables command entry while the server is stopped', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(snapshot([])));
		render(ServerConsole, { serverId: 's1', running: false });
		await expect.element(page.getByLabelText('Console command')).toBeDisabled();
		await expect.element(page.getByText('Start the server to see its console.')).toBeVisible();
	});

	it('posts commands with CSRF header while running', async () => {
		const fetch = vi.fn(async (_path: string, init?: RequestInit) =>
			init?.method === 'POST' ? new Response(null, { status: 204 }) : snapshot(['ready'])
		);
		vi.stubGlobal('fetch', fetch);
		const { unmount } = render(ServerConsole, { serverId: 's1', running: true });
		await page.getByLabelText('Console command').fill('say Hello');
		await page.getByRole('button', { name: 'Send' }).click();
		await vi.waitFor(() => {
			const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
			expect(post?.[0]).toBe('/api/v1/servers/s1/console/commands');
			expect((post?.[1]?.headers as Record<string, string>)['X-MCM-CSRF']).toBe('1');
			expect(JSON.parse(String(post?.[1]?.body))).toEqual({ line: 'say Hello' });
		});
		await expect.element(page.getByLabelText('Console command')).toHaveValue('');
		unmount();
	});

	it('stops polling after unmount', async () => {
		const fetch = vi.fn().mockResolvedValue(snapshot(['x']));
		vi.stubGlobal('fetch', fetch);
		const { unmount } = render(ServerConsole, { serverId: 's1', running: true });
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		unmount();
		const calls = fetch.mock.calls.length;
		await new Promise((r) => setTimeout(r, 3500));
		expect(fetch.mock.calls.length).toBe(calls);
	});
});
