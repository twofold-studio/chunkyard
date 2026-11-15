import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	installFakeIntersectionObserver,
	setIntersecting
} from '../../../tests/fake-intersection-observer.js';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import CardUsage from './card-usage.svelte';
import { MetricsHub } from '#lib/servers/metrics-hub.svelte.js';
import type { SocketLike } from '#lib/console/console-stream.js';
import { METRICS_INTERVAL_KEY, metricsInterval } from '#lib/metrics-interval.svelte.js';
import type { ServerMetrics } from '#lib/api/index.js';

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
}

const GiB = 1024 ** 3;
const at = (seconds: number, extra: Partial<ServerMetrics> = {}): ServerMetrics => ({
	serverId: 's1',
	status: { state: 'running', containerId: 'c', exitCode: null, oomKilled: false },
	sampledAt: new Date(Date.UTC(2026, 9, 1, 0, 0, seconds)).toISOString(),
	startedAt: null,
	uptimeSeconds: null,
	cpuPercent: 50,
	memoryUsageBytes: 2 * GiB,
	memoryWorkingSetBytes: 1.5 * GiB,
	memoryLimitBytes: 4 * GiB,
	networkRxBytes: null,
	networkTxBytes: null,
	blockReadBytes: null,
	blockWriteBytes: null,
	pids: null,
	...extra
});

let sockets: FakeSocket[];
let hub: MetricsHub;
beforeEach(() => {
	installFakeIntersectionObserver();
	sockets = [];
	hub = new MetricsHub();
	hub.configure({
		createSocket: (url) => {
			const socket = new FakeSocket(url);
			sockets.push(socket);
			return socket;
		},
		streamUrl: (id, ms) => `ws://x/${id}?intervalMs=${ms}`
	});
});
afterEach(() => {
	hub.reset();
	vi.unstubAllGlobals();
	localStorage.removeItem(METRICS_INTERVAL_KEY);
	metricsInterval.reload();
});

describe('CardUsage', () => {
	it('streams at standby despite a saved sub-second rate and charts samples with gaps, never zeros', async () => {
		metricsInterval.set(100);
		const view = render(CardUsage, { serverId: 's1', cpus: 2, hub });
		await expect.element(page.getByTestId('card-usage')).toBeVisible();
		// Cards never inherit the persisted 100 ms: at least 5s.
		await vi.waitFor(() =>
			expect(sockets.map((s) => s.url)).toEqual(['ws://x/s1?intervalMs=5000'])
		);
		// Nothing measured yet: dashes, not 0.
		await expect.element(page.getByText('CPU', { exact: true })).toBeVisible();
		expect(page.getByTestId('card-usage').element().textContent).toContain('—');

		sockets[0].send({ type: 'sample', sample: at(1, { cpuPercent: 40 }) });
		sockets[0].send({ type: 'sample', sample: at(2, { cpuPercent: 60 }) });
		await expect.element(page.getByTestId('card-cpu')).toHaveTextContent('60.0%');
		await expect.element(page.getByTestId('card-ram')).toHaveTextContent('1.5 GiB');
		sockets[0].send({ type: 'error', code: 'docker.unavailable', detail: 'down' });
		await expect.element(page.getByTestId('card-cpu')).toHaveTextContent('—');
		sockets[0].send({ type: 'sample', sample: at(4, { cpuPercent: 30 }) });
		await expect.element(page.getByTestId('card-cpu')).toHaveTextContent('30.0%');
		const cpuChart = page.getByRole('img').first().element();
		expect(cpuChart.getAttribute('data-runs')).toBe('2');
		expect(cpuChart.getAttribute('aria-label')).toMatch(/with 1 gap/);

		view.unmount();
		expect(sockets[0].closed).toBe(true);
		expect(hub.streams).toBe(0);
	});

	it('shares one stream between two views of the same server', async () => {
		metricsInterval.set(1000);
		const a = render(CardUsage, { serverId: 's1', cpus: 1, hub });
		const b = render(CardUsage, { serverId: 's1', cpus: 1, hub });
		await expect.element(page.getByTestId('card-usage').first()).toBeVisible();
		await vi.waitFor(() => expect(sockets).toHaveLength(1));
		expect(sockets[0].url).toBe('ws://x/s1?intervalMs=5000');
		a.unmount();
		expect(sockets[0].closed).toBe(false);
		b.unmount();
		expect(sockets[0].closed).toBe(true);
	});

	it('opens nothing when live usage is off', async () => {
		metricsInterval.set(0);
		render(CardUsage, { serverId: 's1', cpus: 1, hub });
		await expect.element(page.getByText('Live usage off')).toBeVisible();
		expect(sockets).toHaveLength(0);
	});

	it('respects slower saved preferences', async () => {
		metricsInterval.set(30000);
		const view = render(CardUsage, { serverId: 's1', cpus: 1, hub });
		await vi.waitFor(() =>
			expect(sockets.map((s) => s.url)).toEqual(['ws://x/s1?intervalMs=30000'])
		);
		view.unmount();
	});

	it('releases the subscription off-screen, keeps history and resubscribes on return', async () => {
		metricsInterval.set(5000);
		const view = render(CardUsage, { serverId: 's1', cpus: 1, hub });
		await vi.waitFor(() => expect(sockets).toHaveLength(1));
		sockets[0].send({ type: 'sample', sample: at(1, { cpuPercent: 40 }) });
		sockets[0].send({ type: 'sample', sample: at(2, { cpuPercent: 45 }) });
		await expect.element(page.getByTestId('card-cpu')).toHaveTextContent('45.0%');

		setIntersecting(false);
		await vi.waitFor(() => expect(sockets[0].closed).toBe(true));
		expect(hub.streams).toBe(0);
		expect(hub.channel('s1').history).toHaveLength(2);
		await expect.element(page.getByTestId('card-usage')).toHaveAttribute('data-live', 'false');

		setIntersecting(true);
		await vi.waitFor(() => expect(sockets).toHaveLength(2));
		expect(sockets[1].url).toBe('ws://x/s1?intervalMs=5000');
		expect(hub.streams).toBe(1);
		view.unmount();
		expect(hub.streams).toBe(0);
	});

	it('starts nothing for a card that mounts off-screen', async () => {
		installFakeIntersectionObserver(false);
		metricsInterval.set(5000);
		const view = render(CardUsage, { serverId: 's1', cpus: 1, hub });
		await expect.element(page.getByTestId('card-usage')).toHaveAttribute('data-live', 'false');
		await new Promise((r) => setTimeout(r, 50));
		expect(sockets).toHaveLength(0);
		view.unmount();
	});

	it('without IntersectionObserver still watches, but only at standby', async () => {
		vi.stubGlobal('IntersectionObserver', undefined);
		metricsInterval.set(250);
		const view = render(CardUsage, { serverId: 's1', cpus: 1, hub });
		await vi.waitFor(() =>
			expect(sockets.map((s) => s.url)).toEqual(['ws://x/s1?intervalMs=5000'])
		);
		view.unmount();
		expect(hub.streams).toBe(0);
	});
});
