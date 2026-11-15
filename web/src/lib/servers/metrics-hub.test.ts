import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ServerMetrics } from '#lib/api/index.js';
import type { SocketLike } from '#lib/console/console-stream.js';
import { MetricsHub, type MetricsHubOptions } from './metrics-hub.svelte';
import { metricsStreamUrl, parseMetricsFrame } from './metrics-stream';

class FakeSocket implements SocketLike {
	onopen: SocketLike['onopen'] = null;
	onmessage: SocketLike['onmessage'] = null;
	onclose: SocketLike['onclose'] = null;
	onerror: SocketLike['onerror'] = null;
	closed = false;
	constructor(readonly url: string) {}
	close() {
		this.closed = true;
	}
	send(frame: unknown) {
		this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
	}
	drop() {
		this.onclose?.({ code: 1006 } as CloseEvent);
	}
}

const at = (id: string, seconds: number, extra: Partial<ServerMetrics> = {}): ServerMetrics => ({
	serverId: id,
	status: { state: 'running', containerId: 'c', exitCode: null, oomKilled: false },
	sampledAt: new Date(Date.UTC(2026, 9, 1, 0, 0, seconds)).toISOString(),
	startedAt: null,
	uptimeSeconds: null,
	cpuPercent: 10 + seconds,
	memoryUsageBytes: 1,
	memoryWorkingSetBytes: 1,
	memoryLimitBytes: 2,
	networkRxBytes: null,
	networkTxBytes: null,
	blockReadBytes: null,
	blockWriteBytes: null,
	pids: null,
	...extra
});

let sockets: FakeSocket[];
let visible: boolean;
function hub(options: Partial<MetricsHubOptions> = {}) {
	const instance = new MetricsHub();
	instance.configure({
		createSocket: (url) => {
			const socket = new FakeSocket(url);
			sockets.push(socket);
			return socket;
		},
		isVisible: () => visible,
		streamUrl: (id, ms) => `ws://x/${id}?intervalMs=${ms}`,
		fetchMetrics: vi.fn(async (id: string) => at(id, 1)),
		...options
	});
	return instance;
}

beforeEach(() => {
	sockets = [];
	visible = true;
});
afterEach(() => vi.useRealTimers());

describe('metrics stream frames', () => {
	it('validates frames and clamps the requested interval', () => {
		expect(parseMetricsFrame(JSON.stringify({ type: 'sample', sample: at('a', 1) }))).toEqual({
			type: 'sample',
			sample: at('a', 1)
		});
		expect(
			parseMetricsFrame(JSON.stringify({ type: 'sample', sample: { serverId: 'a' } }))
		).toBeNull();
		expect(parseMetricsFrame('not json')).toBeNull();
		expect(parseMetricsFrame(JSON.stringify({ type: 'end' }))).toEqual({ type: 'end' });
		const loc = { protocol: 'https:', host: 'mc.example' };
		expect(metricsStreamUrl('a b', 50, loc)).toBe(
			'wss://mc.example/api/v1/servers/a%20b/metrics/stream?intervalMs=100'
		);
		expect(metricsStreamUrl('a', 90_000, { protocol: 'http:', host: 'h' })).toBe(
			'ws://h/api/v1/servers/a/metrics/stream?intervalMs=60000'
		);
	});
});

describe('MetricsHub', () => {
	it('shares one stream per server and closes it with the last watcher', () => {
		const h = hub();
		const a = h.watch('s1', 1000);
		const b = h.watch('s1', 250);
		expect(sockets).toHaveLength(2); // restarted once at the faster interval
		expect(sockets[0].closed).toBe(true);
		expect(sockets[1].url).toBe('ws://x/s1?intervalMs=250');
		expect(h.streams).toBe(1);
		b.release();
		expect(sockets.at(-1)!.url).toBe('ws://x/s1?intervalMs=1000');
		a.release();
		expect(sockets.every((s) => s.closed)).toBe(true);
		expect(h.streams).toBe(0);
	});

	it('records only fresh measurements and keeps gaps honest', () => {
		const h = hub();
		const sub = h.watch('s1', 100);
		const ws = sockets[0];
		ws.send({ type: 'sample', sample: at('s1', 1) });
		ws.send({ type: 'sample', sample: at('s1', 1, { cpuPercent: 99 }) }); // same measurement
		ws.send({ type: 'sample', sample: at('s1', 0) }); // older
		ws.send({ type: 'sample', sample: at('other', 5) }); // another server
		expect(sub.channel.history.map((p) => p.cpu)).toEqual([11]);
		expect(sub.channel.sample?.cpuPercent).toBe(11);

		ws.send({ type: 'error', code: 'metrics.busy', detail: 'busy' });
		expect(sub.channel.sample?.cpuPercent).toBe(11);
		ws.send({ type: 'error', code: 'docker.unavailable', detail: 'down' });
		expect(sub.channel.sample).toBeNull();
		expect(sub.channel.history.at(-1)?.cpu).toBeNull();
		ws.send({ type: 'sample', sample: at('s1', 3) });
		expect(sub.channel.history.map((p) => p.cpu)).toEqual([11, null, 13]);
		sub.release();
	});

	it('caps open streams and polls the rest no faster than once a second', async () => {
		vi.useFakeTimers();
		let n = 0;
		const fetchMetrics = vi.fn(async (id: string) => at(id, n++));
		const h = hub({ maxStreams: 2, fetchMetrics });
		const subs = ['a', 'b', 'c'].map((id) => h.watch(id, 100));
		expect(sockets).toHaveLength(2);
		expect(subs[2].channel.transport).toBe('poll');
		await vi.advanceTimersByTimeAsync(3050);
		const calls = fetchMetrics.mock.calls.filter(([id]) => id === 'c').length;
		expect(calls).toBeGreaterThanOrEqual(3);
		expect(calls).toBeLessThanOrEqual(4); // 1 immediate + one per second
		subs.forEach((s) => s.release());
		const after = fetchMetrics.mock.calls.length;
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchMetrics.mock.calls.length).toBe(after);
	});

	it('limits concurrent REST requests across servers', async () => {
		let inFlight = 0;
		let peak = 0;
		const pending: (() => void)[] = [];
		const fetchMetrics = vi.fn(
			(id: string) =>
				new Promise<ServerMetrics>((resolve) => {
					inFlight += 1;
					peak = Math.max(peak, inFlight);
					pending.push(() => {
						inFlight -= 1;
						resolve(at(id, 1));
					});
				})
		);
		const h = hub({ createSocket: null, pollConcurrency: 2, fetchMetrics });
		const subs = ['a', 'b', 'c', 'd', 'e'].map((id) => h.watch(id, 1000));
		await Promise.resolve();
		expect(fetchMetrics).toHaveBeenCalledTimes(2);
		while (pending.length) {
			pending.shift()!();
			await new Promise((r) => setTimeout(r, 0));
		}
		expect(fetchMetrics).toHaveBeenCalledTimes(5);
		expect(peak).toBe(2);
		subs.forEach((s) => s.release());
	});

	it('closes everything while hidden and resumes when visible', () => {
		const h = hub();
		const sub = h.watch('s1', 500);
		expect(h.streams).toBe(1);
		visible = false;
		h.visibilityChanged();
		expect(sockets[0].closed).toBe(true);
		expect(h.streams).toBe(0);
		visible = true;
		h.visibilityChanged();
		expect(sockets).toHaveLength(2);
		expect(h.streams).toBe(1);
		sub.release();
	});

	it('returns a REST slot when a queued watcher is aborted during handoff', async () => {
		let completeFirst!: () => void;
		const fetchMetrics = vi.fn((id: string) =>
			id === 'a'
				? new Promise<ServerMetrics>((resolve) => {
						completeFirst = () => resolve(at(id, 1));
					})
				: Promise.resolve(at(id, 1))
		);
		const h = hub({ createSocket: null, pollConcurrency: 1, fetchMetrics });
		const a = h.watch('a', 1000);
		const b = h.watch('b', 1000);
		const c = h.watch('c', 1000);
		completeFirst();
		await Promise.resolve();
		b.release();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fetchMetrics.mock.calls.map(([id]) => id)).toEqual(['a', 'c']);
		a.release();
		c.release();
	});

	it('keeps the stream cap when another watcher takes a reconnecting slot', async () => {
		vi.useFakeTimers();
		const h = hub({ maxStreams: 1, retryDelaysMs: [10] });
		const a = h.watch('a', 100);
		sockets[0].drop();
		const b = h.watch('b', 100);
		await vi.advanceTimersByTimeAsync(11);
		expect(h.streams).toBe(1);
		expect(sockets).toHaveLength(2);
		expect(a.channel.transport).toBe('poll');
		a.release();
		b.release();
	});

	it('falls back to REST after the stream keeps failing', async () => {
		vi.useFakeTimers();
		const fetchMetrics = vi.fn(async (id: string) => at(id, 7));
		const h = hub({ retryDelaysMs: [10, 10], fetchMetrics });
		const sub = h.watch('s1', 100);
		sockets[0].drop();
		await vi.advanceTimersByTimeAsync(11);
		sockets[1].drop();
		await vi.advanceTimersByTimeAsync(11);
		sockets[2].drop();
		await vi.advanceTimersByTimeAsync(0);
		expect(sub.channel.transport).toBe('poll');
		expect(h.streams).toBe(0);
		expect(sub.channel.sample?.cpuPercent).toBe(17);
		sub.release();
	});

	it('records one-off snapshots and their failures on the shared channel', async () => {
		const fetchMetrics = vi
			.fn()
			.mockResolvedValueOnce(at('s1', 2))
			.mockRejectedValueOnce(new ApiError(424, 'docker.unavailable', 'down'));
		const h = hub({ fetchMetrics });
		await h.snapshot('s1', new AbortController().signal);
		expect(h.channel('s1').sample?.cpuPercent).toBe(12);
		await expect(h.snapshot('s1', new AbortController().signal)).rejects.toThrow();
		expect(h.channel('s1').sample).toBeNull();
		expect(h.channel('s1').history.map((p) => p.cpu)).toEqual([12, null]);
	});
});
