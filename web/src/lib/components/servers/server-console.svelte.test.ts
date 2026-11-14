import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerConsole from './server-console.svelte';
import type { SocketLike } from '#lib/console/console-stream.js';

class FakeSocket implements SocketLike {
	static all: FakeSocket[] = [];
	onopen: SocketLike['onopen'] = null;
	onmessage: SocketLike['onmessage'] = null;
	onclose: SocketLike['onclose'] = null;
	onerror: SocketLike['onerror'] = null;
	closed = false;
	constructor(readonly url: string) {
		FakeSocket.all.push(this);
	}
	close() {
		this.closed = true;
	}
	open() {
		this.onopen?.(new Event('open'));
	}
	send(frame: unknown) {
		this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
	}
}
const createSocket = (url: string) => new FakeSocket(url);
const out = (text: string) => ({ stream: 'stdout', text });

function snapshot(lines: string[]) {
	return new Response(
		JSON.stringify({ items: lines.map((text) => ({ stream: 'stdout', text })) }),
		{
			headers: { 'content-type': 'application/json' }
		}
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	FakeSocket.all = [];
});

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
		const { unmount } = render(ServerConsole, {
			serverId: 's1',
			running: true,
			createSocket: null
		});
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
		const { unmount } = render(ServerConsole, {
			serverId: 's1',
			running: true,
			createSocket: null
		});
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		unmount();
		const calls = fetch.mock.calls.length;
		await new Promise((r) => setTimeout(r, 3500));
		expect(fetch.mock.calls.length).toBe(calls);
	});

	it('streams live output over one WebSocket without polling', async () => {
		const fetch = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', fetch);
		render(ServerConsole, { serverId: 's1', running: true, createSocket });
		await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
		const socket = FakeSocket.all[0];
		expect(socket.url).toMatch(/^ws:\/\/.*\/api\/v1\/servers\/s1\/console\/stream$/);
		socket.open();
		socket.send({ type: 'snapshot', lines: [out('one'), out('two')] });
		socket.send({ type: 'line', line: out('three') });
		const log = page.getByRole('log');
		await expect.element(log).toHaveTextContent('three');
		await expect.element(page.getByText(/^Live/)).toBeVisible();
		// A reconnect snapshot replaces the buffer instead of duplicating lines.
		socket.send({ type: 'snapshot', lines: [out('one'), out('two'), out('three')] });
		await expect.element(log).toHaveTextContent('three');
		expect(log.element().textContent?.match(/one/g)).toHaveLength(1);
		await new Promise((r) => setTimeout(r, 300));
		expect(fetch).not.toHaveBeenCalled();
		// Commands still use the POST route; the reply arrives on the stream.
		await page.getByLabelText('Console command').fill('list');
		await page.getByRole('button', { name: 'Send' }).click();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
		await new Promise((r) => setTimeout(r, 800));
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('falls back to snapshot polling when the stream cannot be used', async () => {
		const fetch = vi.fn().mockResolvedValue(snapshot(['polled']));
		vi.stubGlobal('fetch', fetch);
		render(ServerConsole, {
			serverId: 's1',
			running: true,
			createSocket: () => {
				throw new Error('blocked');
			}
		});
		await expect.element(page.getByRole('log')).toHaveTextContent('polled');
		await expect.element(page.getByText(/Refreshes every 3s/)).toBeVisible();
	});

	it('closes the socket on unmount and does not open one while stopped', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(snapshot(['old'])));
		const screen = render(ServerConsole, { serverId: 's1', running: true, createSocket });
		await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
		await screen.rerender({ running: false });
		await vi.waitFor(() => expect(FakeSocket.all[0].closed).toBe(true));
		await expect.element(page.getByRole('log')).toHaveTextContent('old');
		expect(FakeSocket.all).toHaveLength(1);
		await screen.rerender({ running: true });
		await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(2));
		screen.unmount();
		expect(FakeSocket.all[1].closed).toBe(true);
	});
});
