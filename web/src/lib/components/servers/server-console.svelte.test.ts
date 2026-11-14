import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
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

async function liveConsole(serverId = 's1') {
	const fetch = vi.fn(async (_path: string, init?: RequestInit) =>
		init?.method === 'POST' ? new Response(null, { status: 204 }) : snapshot([])
	);
	vi.stubGlobal('fetch', fetch);
	const screen = render(ServerConsole, { serverId, running: true, createSocket });
	await vi.waitFor(() => expect(FakeSocket.all.length).toBeGreaterThan(0));
	const socket = FakeSocket.all.at(-1)!;
	socket.open();
	return { fetch, screen, socket };
}

const posts = (fetch: ReturnType<typeof vi.fn>) =>
	fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

describe('ServerConsole tools', () => {
	it('filters the view only: the live buffer keeps streaming and snapshots still replace', async () => {
		const { socket } = await liveConsole();
		socket.send({ type: 'snapshot', lines: [out('Player joined'), out('Saving world')] });
		const log = page.getByRole('log');
		await expect.element(log).toHaveTextContent('Saving world');
		await page.getByLabelText('Filter console output').fill('PLAYER');
		await expect.element(log).not.toHaveTextContent('Saving world');
		await expect.element(page.getByText('1 of 2 lines')).toBeVisible();
		expect(log.element().querySelector('mark')?.textContent).toBe('Player');
		socket.send({ type: 'line', line: out('player left') });
		await expect.element(page.getByText('2 of 3 lines')).toBeVisible();
		socket.send({ type: 'snapshot', lines: [out('Saving world')] });
		await expect.element(page.getByText('No lines match “PLAYER”.')).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(log).toHaveTextContent('Saving world');
		expect(log.element().textContent?.match(/Saving world/g)).toHaveLength(1);
	});

	it('renders and exports hostile output as plain text', async () => {
		const { socket } = await liveConsole();
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		const blobs: Blob[] = [];
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			blobs.push(blob as Blob);
			return 'blob:test';
		});
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		socket.send({ type: 'snapshot', lines: [out('<img src=x onerror=alert(1)>'), out('a & b')] });
		const log = page.getByRole('log');
		await expect.element(log).toHaveTextContent('<img src=x onerror=alert(1)>');
		expect(log.element().querySelector('img')).toBeNull();
		await page.getByRole('button', { name: 'Copy' }).click();
		await vi.waitFor(() =>
			expect(writeText).toHaveBeenCalledWith('<img src=x onerror=alert(1)>\na & b\n')
		);
		await page.getByRole('button', { name: 'Download' }).click();
		expect(blobs[0].type).toBe('text/plain;charset=utf-8');
		expect(await blobs[0].text()).toBe('<img src=x onerror=alert(1)>\na & b\n');
		const anchor = click.mock.contexts[0] as HTMLAnchorElement;
		expect(anchor.download).toMatch(/^s1-console-\d{8}-\d{6}\.txt$/);
		createObjectURL.mockRestore();
		click.mockRestore();
	});

	it('copies only the bounded buffer the browser holds', async () => {
		const { socket } = await liveConsole();
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		socket.send({
			type: 'snapshot',
			lines: Array.from({ length: 1005 }, (_, i) => out(`line ${i}`))
		});
		await expect.element(page.getByRole('log')).toHaveTextContent('line 1004');
		await page.getByRole('button', { name: 'Copy' }).click();
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
		const copied = (writeText.mock.calls[0] as unknown as [string])[0].trimEnd().split('\n');
		expect(copied).toHaveLength(1000);
		expect(copied[0]).toBe('line 5');
	});

	it('toggles wrapping', async () => {
		const { socket } = await liveConsole();
		socket.send({ type: 'snapshot', lines: [out('x'.repeat(400))] });
		const wrap = page.getByRole('button', { name: 'Wrap' });
		await expect.element(wrap).toHaveAttribute('aria-pressed', 'true');
		const row = () => page.getByRole('log').element().querySelector('div')!;
		await vi.waitFor(() => expect(row().className).toContain('whitespace-pre-wrap'));
		await wrap.click();
		await expect.element(wrap).toHaveAttribute('aria-pressed', 'false');
		expect(row().className).not.toContain('whitespace-pre-wrap');
	});

	it('pauses following on scroll up, counts new lines and jumps back to the latest', async () => {
		const { socket } = await liveConsole();
		socket.send({
			type: 'snapshot',
			lines: Array.from({ length: 200 }, (_, i) => out(`line ${i}`))
		});
		const log = page.getByRole('log');
		await expect.element(log).toHaveTextContent('line 199');
		const viewport = log.element() as HTMLElement;
		// Component tests run without the app stylesheet: give the log a real height.
		Object.assign(viewport.style, { height: '200px', overflow: 'auto' });
		await page.getByRole('button', { name: 'Follow' }).click();
		await page.getByRole('button', { name: /jump to latest/ }).click();
		await vi.waitFor(() =>
			expect(viewport.scrollTop + viewport.clientHeight).toBeGreaterThan(viewport.scrollHeight - 30)
		);
		viewport.scrollTop = 0;
		viewport.dispatchEvent(new Event('scroll'));
		const follow = page.getByRole('button', { name: 'Follow' });
		await expect.element(follow).toHaveAttribute('aria-pressed', 'false');
		socket.send({ type: 'line', line: out('new one') });
		socket.send({ type: 'line', line: out('new two') });
		const jump = page.getByRole('button', { name: /Paused · 2 new/ });
		await expect.element(jump).toBeVisible();
		expect(viewport.scrollTop).toBe(0);
		await jump.click();
		await expect.element(follow).toHaveAttribute('aria-pressed', 'true');
		await vi.waitFor(() =>
			expect(viewport.scrollTop + viewport.clientHeight).toBeGreaterThan(viewport.scrollHeight - 30)
		);
		await expect.element(page.getByRole('button', { name: /Paused/ })).not.toBeInTheDocument();
	});

	it('recalls commands per server with Up/Down without sending them', async () => {
		const { fetch, screen } = await liveConsole('hist-a');
		const input = page.getByLabelText('Console command');
		for (const line of ['list', 'say hi']) {
			await input.fill(line);
			await userEvent.keyboard('{Enter}');
			await expect.element(input).toHaveValue('');
		}
		expect(posts(fetch)).toHaveLength(2);
		await input.fill('dra');
		await userEvent.keyboard('{ArrowUp}');
		await expect.element(input).toHaveValue('say hi');
		await userEvent.keyboard('{ArrowUp}');
		await expect.element(input).toHaveValue('list');
		await userEvent.keyboard('{ArrowUp}');
		await expect.element(input).toHaveValue('list');
		await userEvent.keyboard('{ArrowDown}{ArrowDown}');
		await expect.element(input).toHaveValue('dra');
		// Typing still edits normally after recall.
		await userEvent.keyboard('{ArrowUp}{Backspace}{Backspace}x');
		await expect.element(input).toHaveValue('say x');
		expect(posts(fetch)).toHaveLength(2);
		screen.unmount();

		// Another server has its own (empty) history; the first one's survives remounts.
		FakeSocket.all = [];
		await liveConsole('hist-b');
		await userEvent.click(page.getByLabelText('Console command'));
		await userEvent.keyboard('{ArrowUp}');
		await expect.element(page.getByLabelText('Console command')).toHaveValue('');
	});
});
