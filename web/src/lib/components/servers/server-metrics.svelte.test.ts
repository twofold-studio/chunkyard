import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerMetrics from '../../../tests/metrics-harness.svelte';
import { METRICS_INTERVAL_KEY, metricsInterval } from '#lib/metrics-interval.svelte.js';
import { metricsHub } from '#lib/servers/metrics-hub.svelte.js';
import type { SocketLike } from '#lib/console/console-stream.js';
import {
	FakeIntersectionObserver,
	focusWindow,
	installFakeIntersectionObserver,
	setIntersecting,
	setWindowFocus
} from '../../../tests/fake-intersection-observer.js';

const GiB = 1024 ** 3;

function sample(overrides: Record<string, unknown> = {}) {
	return {
		serverId: 's1',
		status: { state: 'running', containerId: 'c1', exitCode: null, oomKilled: false },
		sampledAt: new Date().toISOString(),
		startedAt: new Date(Date.now() - 3725_000).toISOString(),
		uptimeSeconds: 3725,
		cpuPercent: 12.5,
		memoryUsageBytes: 2 * GiB,
		memoryWorkingSetBytes: 1.5 * GiB,
		memoryLimitBytes: 4 * GiB,
		networkRxBytes: 1024,
		networkTxBytes: 2048,
		blockReadBytes: 0,
		blockWriteBytes: 4096,
		pids: 42,
		...overrides
	};
}

const STOPPED = sample({
	status: { state: 'stopped', containerId: null, exitCode: 0, oomKilled: false },
	startedAt: null,
	uptimeSeconds: null,
	cpuPercent: null,
	memoryUsageBytes: null,
	memoryWorkingSetBytes: null,
	memoryLimitBytes: null,
	networkRxBytes: null,
	networkTxBytes: null,
	blockReadBytes: null,
	blockWriteBytes: null,
	pids: null
});

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': status === 200 ? 'application/json' : 'application/problem+json' }
	});
}

// These cases cover the REST path (no WebSocket); the stream has its own tests. Chart
// visibility and window focus are simulated (headless frames cannot be scrolled or focused).
beforeEach(() => {
	metricsHub.configure({ createSocket: null });
	installFakeIntersectionObserver();
	focusWindow();
});

afterEach(() => {
	metricsHub.reset();
	vi.unstubAllGlobals();
	localStorage.removeItem(METRICS_INTERVAL_KEY);
	metricsInterval.reload();
});

describe('ServerMetrics', () => {
	it('shows a single snapshot with em dashes, never zeros, while stopped', async () => {
		const fetch = vi.fn().mockImplementation(async () => json(STOPPED));
		vi.stubGlobal('fetch', fetch);
		render(ServerMetrics, { serverId: 's1', serverState: 'stopped', cpus: 2 });
		await expect.element(page.getByText('Not running')).toBeVisible();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		expect(fetch.mock.calls[0][0]).toBe('/api/v1/servers/s1/metrics');
		for (const id of ['metric-cpu', 'metric-memory']) {
			await expect.element(page.getByTestId(id)).toHaveTextContent('—');
		}
		await expect.element(page.getByTestId('metric-uptime')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('header-usage')).toHaveTextContent('no live usage');
		const section = page.getByRole('region', { name: 'Usage' }).element();
		expect(section.textContent).not.toMatch(/\b0(\.0)?\s?(%|B)\b/);
		await new Promise((r) => setTimeout(r, 300));
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('shows CPU above 100% relative to one core', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(async () => json(sample({ cpuPercent: 250.4 })))
		);
		const { unmount } = render(ServerMetrics, {
			serverId: 's1',
			serverState: 'running',
			cpus: 2
		});
		await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('250%');
		await expect.element(page.getByText(/relative to one core \(can exceed 100%\)/)).toBeVisible();
		await expect.element(page.getByTestId('metric-memory')).toHaveTextContent('1.5 GiB');
		await expect.element(page.getByTestId('metric-uptime')).toHaveTextContent('1h 2m');
		// Redundant usage bars are gone; the two charts carry the readings.
		expect(document.querySelector('[role="meter"]')).toBeNull();
		await expect
			.element(page.getByTestId('header-usage'))
			.toHaveTextContent('CPU 250% · RAM 1.5 GiB');
		unmount();
	});

	it('aborts an in-flight sample on server change and on unmount', async () => {
		const signals: AbortSignal[] = [];
		const fetch = vi.fn((_path: string, init?: RequestInit) => {
			signals.push(init!.signal!);
			return new Promise<Response>((_resolve, reject) =>
				init!.signal!.addEventListener('abort', () =>
					reject(new DOMException('Aborted', 'AbortError'))
				)
			);
		});
		vi.stubGlobal('fetch', fetch);
		const { rerender, unmount } = render(ServerMetrics, {
			serverId: 's1',
			serverState: 'running'
		});
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		await rerender({ serverId: 's2', serverState: 'running' });
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
		expect(signals[0].aborted).toBe(true);
		expect(fetch.mock.calls[1][0]).toBe('/api/v1/servers/s2/metrics');
		unmount();
		expect(signals[1].aborted).toBe(true);
	});

	it('clears stale measurements when the server stops', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(json(sample({ cpuPercent: 80 })))
			.mockImplementation(async () => json(STOPPED));
		vi.stubGlobal('fetch', fetch);
		const { rerender } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('80.0%');
		await rerender({ serverId: 's1', serverState: 'stopped' });
		await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('—');
		await expect.element(page.getByTestId('metric-memory')).toHaveTextContent('—');
	});

	it('reports a missing Docker daemon without zeros and retries on demand', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				json({ code: 'docker.unavailable', detail: 'Docker is not reachable.' }, 424)
			)
			.mockImplementation(async () => json(STOPPED));
		vi.stubGlobal('fetch', fetch);
		render(ServerMetrics, { serverId: 's1', serverState: 'stopped' });
		await expect.element(page.getByText('Docker unavailable; no measurements.')).toBeVisible();
		await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('—');
		await page.getByRole('button', { name: 'Retry' }).click();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
		await expect.element(page.getByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
	});

	it('keeps the last sample and stays quiet when the sampler is busy', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(json(sample({ cpuPercent: 33 })))
			.mockImplementation(async () =>
				json({ code: 'metrics.busy', detail: 'All metrics sampling slots are busy.' }, 429)
			);
		vi.stubGlobal('fetch', fetch);
		const { unmount } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('33.0%');
		await page.getByRole('button', { name: 'Refresh metrics' }).click();
		await expect.element(page.getByText('Metrics sampler busy; retrying shortly.')).toBeVisible();
		await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('33.0%');
		unmount();
	});

	it('polls at the saved interval and shares the browser preference', async () => {
		metricsInterval.set(1000);
		expect(localStorage.getItem(METRICS_INTERVAL_KEY)).toBe('1000');
		const fetch = vi.fn().mockImplementation(async () => json(sample()));
		vi.stubGlobal('fetch', fetch);
		const screen = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await expect.element(page.getByText(/every 1s/)).toBeVisible();
		await vi.waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2), {
			timeout: 2500
		});
		await expect
			.element(page.getByRole('combobox', { name: 'Metrics refresh interval' }))
			.toHaveTextContent('1s');
		// Unmount before fetch is unstubbed so no tick reaches the network.
		screen.unmount();
	});

	it('stops automatic refresh when Off, keeps the snapshot and allows manual refresh', async () => {
		const fetch = vi.fn().mockImplementation(async () => json(sample()));
		vi.stubGlobal('fetch', fetch);
		const screen = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		await page.getByRole('combobox', { name: 'Metrics refresh interval' }).click();
		await page.getByRole('option', { name: 'Off' }).click();
		await expect.element(page.getByText(/^Paused/)).toBeVisible();
		expect(localStorage.getItem(METRICS_INTERVAL_KEY)).toBe('0');
		await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('12.5%');
		await new Promise((r) => setTimeout(r, 300));
		expect(fetch).toHaveBeenCalledTimes(1);
		await page.getByRole('button', { name: 'Refresh metrics' }).click();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
		screen.unmount();
	});

	describe('session history', () => {
		const at = (ms: number, extra: Record<string, unknown> = {}) =>
			sample({ sampledAt: new Date(Date.now() + ms).toISOString(), ...extra });

		it('charts samples collected while open, labelled as not stored', async () => {
			metricsInterval.set(1000);
			let n = 0;
			const fetch = vi.fn(async () => json(at(n * 1000, { cpuPercent: 10 + 10 * n++ })));
			vi.stubGlobal('fetch', fetch);
			const { unmount } = render(ServerMetrics, {
				serverId: 's1',
				serverState: 'running',
				cpus: 2
			});
			const history = page.getByTestId('metrics-history');
			await expect
				.element(history.element().parentElement!)
				.toHaveTextContent('History collected while this page is open');
			await expect.element(history.element().parentElement!).toHaveTextContent(/not\s+stored/);
			await vi.waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2), {
				timeout: 4000
			});
			const cpu = page.getByRole('img', { name: /^CPU over/ });
			// The first request may be aborted when the visible chart lifts the 5s standby
			// cadence to 1s, so the lowest charted value is the first or second response.
			await expect
				.element(cpu)
				.toHaveAttribute('aria-label', expect.stringMatching(/lowest (10|20)\.0%/));
			await vi.waitFor(
				() => expect(cpu.element().getAttribute('aria-label')).toMatch(/\d+ samples/),
				{
					timeout: 3000
				}
			);
			expect(cpu.element().getAttribute('data-runs')).toBe('1');
			unmount();
		});

		it('starts empty for another server and shows stopped gaps instead of zeros', async () => {
			const fetch = vi
				.fn()
				.mockResolvedValueOnce(json(at(0, { cpuPercent: 40 })))
				.mockResolvedValueOnce(
					json({ ...STOPPED, sampledAt: new Date(Date.now() + 1000).toISOString() })
				)
				.mockResolvedValueOnce(json(at(2000, { cpuPercent: 60 })))
				.mockImplementation(async () => json(at(3000, { serverId: 's2', cpuPercent: 5 })));
			vi.stubGlobal('fetch', fetch);
			const { rerender, unmount } = render(ServerMetrics, {
				serverId: 's1',
				serverState: 'running'
			});
			await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('40.0%');
			await rerender({ serverId: 's1', serverState: 'stopped' });
			await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('—');
			// Let the stopped snapshot land before starting again.
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
			await expect.element(page.getByRole('button', { name: 'Refresh metrics' })).toBeEnabled();
			await rerender({ serverId: 's1', serverState: 'running' });
			await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('60.0%');
			const cpu = page.getByRole('img', { name: /^CPU over/ });
			await expect.element(cpu).toHaveAttribute('data-runs', '2');
			await expect.element(cpu).toHaveAttribute('aria-label', expect.stringContaining('1 gap'));
			expect(cpu.element().getAttribute('aria-label')).not.toMatch(/(^|[^\d.])0(\.0)?%/);

			await rerender({ serverId: 's2', serverState: 'running' });
			await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('5.0%');
			await expect
				.element(page.getByRole('img', { name: /^CPU over/ }))
				.toHaveAttribute('aria-label', expect.stringContaining('1 sample,'));
			unmount();
		});
	});

	describe('single shared source', () => {
		it('keeps one polling loop for the header, slowed to standby, when the charts panel unmounts', async () => {
			metricsInterval.set(1000);
			const fetch = vi.fn().mockImplementation(async () => json(sample()));
			vi.stubGlobal('fetch', fetch);
			const { rerender, unmount } = render(ServerMetrics, {
				serverId: 's1',
				serverState: 'running',
				showPanel: true
			});
			await expect.element(page.getByTestId('header-usage')).toHaveTextContent('CPU 12.5%');
			await expect.element(page.getByText(/every 1s/)).toBeVisible();
			// Another tab: the panel goes away; the header keeps its reading from the same loop,
			// which drops to the 5s standby cadence.
			await rerender({ serverId: 's1', serverState: 'running', showPanel: false });
			await expect.element(page.getByTestId('metric-cpu')).not.toBeInTheDocument();
			const before = fetch.mock.calls.length;
			await new Promise((r) => setTimeout(r, 2300));
			const during = fetch.mock.calls.length - before;
			// A 1s loop (or a second loop) would make 2+ requests here.
			expect(during).toBeLessThanOrEqual(1);
			await expect.element(page.getByTestId('header-usage')).toHaveTextContent('CPU 12.5%');
			unmount();
		});

		it('never presents a paused, hidden or failed sample as live', async () => {
			const fetch = vi
				.fn()
				.mockResolvedValueOnce(json(sample({ cpuPercent: 20 })))
				// A later measurement (the same `sampledAt` would be the same sample, not a new one).
				.mockResolvedValueOnce(
					json(sample({ cpuPercent: 30, sampledAt: new Date(Date.now() + 1000).toISOString() }))
				)
				.mockImplementation(async () =>
					json({ code: 'docker.unavailable', detail: 'Docker is not reachable.' }, 424)
				);
			vi.stubGlobal('fetch', fetch);
			const { unmount } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
			const header = page.getByTestId('header-usage');
			await expect.element(header).toHaveTextContent('CPU 20.0%');

			// Hidden tab: the last sample is no longer current.
			const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
			document.dispatchEvent(new Event('visibilitychange'));
			await expect.element(header).toHaveTextContent('no live usage');
			visibility.mockRestore();
			document.dispatchEvent(new Event('visibilitychange'));
			// Visible again: live updates resume, and only a fresh sample is live again.
			await expect.element(header).toHaveTextContent('CPU 30.0%');

			// Refresh off: the chart keeps the snapshot, the header does not claim it is live.
			await page.getByRole('combobox', { name: 'Metrics refresh interval' }).click();
			await page.getByRole('option', { name: 'Off' }).click();
			await expect.element(header).toHaveTextContent('no live usage');
			await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('30.0%');

			// A failed sample clears the readings everywhere.
			await page.getByRole('button', { name: 'Refresh metrics' }).click();
			await expect.element(page.getByText('Docker unavailable; no measurements.')).toBeVisible();
			await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('—');
			await expect.element(header).toHaveTextContent('no live usage');
			unmount();
		});

		it('drops the previous server reading on switch and stops when inactive', async () => {
			const fetch = vi
				.fn()
				.mockResolvedValueOnce(json(sample({ cpuPercent: 70 })))
				.mockImplementation(
					() => new Promise<Response>(() => {}) // the next server's sample is pending
				);
			vi.stubGlobal('fetch', fetch);
			const { rerender, unmount } = render(ServerMetrics, {
				serverId: 's1',
				serverState: 'running'
			});
			await expect.element(page.getByTestId('header-usage')).toHaveTextContent('CPU 70.0%');
			await rerender({ serverId: 's2', serverState: 'running' });
			// Never show s1's numbers for s2 while its first sample is pending.
			await expect.element(page.getByTestId('header-usage')).toHaveTextContent('no live usage');
			await expect.element(page.getByTestId('metric-cpu')).toHaveTextContent('—');
			const calls = fetch.mock.calls.length;
			await rerender({ serverId: 's2', serverState: 'running', active: false });
			await new Promise((r) => setTimeout(r, 200));
			expect(fetch.mock.calls.length).toBe(calls);
			unmount();
		});
	});
});

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
}

describe('attention-gated cadence (simulated focus and viewport)', () => {
	let sockets: FakeSocket[];
	const open = () => sockets.filter((s) => !s.closed);
	/** Interval of the only open stream; fails if two transports run at once. */
	const streaming = () => {
		const live = open();
		expect(live).toHaveLength(1);
		expect(metricsHub.streams).toBe(1);
		return Number(new URL(live[0].url).searchParams.get('intervalMs'));
	};
	const expectStream = (ms: number) => vi.waitFor(() => expect(streaming()).toBe(ms));
	const hf = () => page.getByRole('switch', { name: 'High frequency' });
	const cadence = () => page.getByTestId('metrics-cadence');

	beforeEach(() => {
		sockets = [];
		metricsHub.configure({
			createSocket: (url) => {
				const socket = new FakeSocket(url);
				sockets.push(socket);
				return socket;
			},
			streamUrl: (id, ms) => `ws://x/${id}?intervalMs=${ms}`
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => json(sample()))
		);
	});

	it('starts with High frequency off despite a saved 100 ms preference', async () => {
		metricsInterval.set(100);
		const { unmount } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await expect.element(hf()).toHaveAttribute('aria-checked', 'false');
		await expectStream(1000);
		await expect.element(cadence()).toHaveTextContent('up to every 1s (High frequency off)');
		// The selection still shows what was asked for.
		await expect
			.element(page.getByRole('combobox', { name: 'Metrics refresh interval' }))
			.toHaveTextContent('100 ms');

		await hf().click();
		await expectStream(100);
		await expect.element(cadence()).toHaveTextContent('up to every 100 ms');
		expect(cadence().element().textContent).not.toMatch(/High frequency off/);
		unmount();
		expect(metricsHub.streams).toBe(0);
	});

	it('picking a sub-second rate in this visit turns High frequency on', async () => {
		const { unmount } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await expectStream(5000);
		await expect.element(hf()).not.toBeInTheDocument();
		await page.getByRole('combobox', { name: 'Metrics refresh interval' }).click();
		await page.getByRole('option', { name: /250 ms/ }).click();
		await expect.element(hf()).toHaveAttribute('aria-checked', 'true');
		await expectStream(250);
		unmount();
	});

	it('drops to standby on window blur and resumes on focus', async () => {
		metricsInterval.set(100);
		const { unmount } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await hf().click();
		await expectStream(100);
		setWindowFocus(false);
		await expectStream(5000);
		await expect.element(cadence()).toHaveTextContent('Standby, every 5s (window not focused)');
		await expect.element(page.getByTestId('metrics-state')).toHaveAttribute('data-mode', 'standby');
		setWindowFocus(true);
		await expectStream(100);
		await expect.element(page.getByTestId('metrics-state')).toHaveAttribute('data-mode', 'active');
		unmount();
	});

	it('drops to standby when the chart leaves the viewport and resumes when it returns', async () => {
		metricsInterval.set(250);
		const { unmount } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await hf().click();
		await expectStream(250);
		setIntersecting(false);
		await expectStream(5000);
		await expect.element(cadence()).toHaveTextContent('(chart out of view)');
		setIntersecting(true);
		await expectStream(250);
		unmount();
	});

	it('keeps one shared transport for the header when the chart unmounts, and resumes on return', async () => {
		metricsInterval.set(100);
		const { rerender, unmount } = render(ServerMetrics, {
			serverId: 's1',
			serverState: 'running',
			showPanel: true
		});
		await hf().click();
		await expectStream(100);
		const observer = FakeIntersectionObserver.instances.at(-1)!;
		const chart = [...observer.elements][0];
		// Another tab (Console, Files…): the header stays live at standby on the same stream.
		await rerender({ serverId: 's1', serverState: 'running', showPanel: false });
		await expectStream(5000);
		expect(observer.disconnected).toBe(true);
		// A late observer entry after disposal must not bring back fast sampling.
		observer.emit(chart, true);
		await new Promise((r) => setTimeout(r, 50));
		expect(streaming()).toBe(5000);
		// Back to Overview: the session choice is still on, so fast sampling resumes.
		await rerender({ serverId: 's1', serverState: 'running', showPanel: true });
		await expect.element(hf()).toHaveAttribute('aria-checked', 'true');
		await expectStream(100);
		unmount();
		expect(metricsHub.streams).toBe(0);
	});

	it('switching High frequency off falls back to 1s; switching servers resets it', async () => {
		metricsInterval.set(500);
		const { rerender, unmount } = render(ServerMetrics, {
			serverId: 's1',
			serverState: 'running'
		});
		await hf().click();
		await expectStream(500);
		await hf().click();
		await expectStream(1000);
		await hf().click();
		await expectStream(500);
		await rerender({ serverId: 's2', serverState: 'running' });
		await expect.element(hf()).toHaveAttribute('aria-checked', 'false');
		await vi.waitFor(() => expect(open().map((s) => s.url)).toEqual(['ws://x/s2?intervalMs=1000']));
		// Even a briefly opened stream must not inherit another server's fast choice.
		expect(sockets.filter((s) => s.url.startsWith('ws://x/s2?')).map((s) => s.url)).toEqual([
			'ws://x/s2?intervalMs=1000'
		]);
		// Returning to the first server does not restore its earlier choice.
		await rerender({ serverId: 's1', serverState: 'running' });
		await expect.element(hf()).toHaveAttribute('aria-checked', 'false');
		await vi.waitFor(() => expect(open().map((s) => s.url)).toEqual(['ws://x/s1?intervalMs=1000']));
		unmount();
	});

	it('never speeds up or reconnects slower preferences on focus changes', async () => {
		metricsInterval.set(10000);
		const { unmount } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await expectStream(10000);
		setWindowFocus(false);
		setIntersecting(false);
		setWindowFocus(true);
		setIntersecting(true);
		await new Promise((r) => setTimeout(r, 50));
		expect(sockets).toHaveLength(1);
		expect(streaming()).toBe(10000);
		unmount();
	});

	it('Off stays off through focus and viewport changes, without extra snapshots', async () => {
		metricsInterval.set(100);
		const fetch = vi.fn(async () => json(sample()));
		vi.stubGlobal('fetch', fetch);
		const { unmount } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await hf().click();
		await expectStream(100);
		await page.getByRole('combobox', { name: 'Metrics refresh interval' }).click();
		await page.getByRole('option', { name: 'Off' }).click();
		await vi.waitFor(() => expect(metricsHub.streams).toBe(0));
		await expect.element(page.getByTestId('metrics-state')).toHaveTextContent(/^Paused/);
		const calls = fetch.mock.calls.length;
		setWindowFocus(false);
		setIntersecting(false);
		setWindowFocus(true);
		setIntersecting(true);
		await new Promise((r) => setTimeout(r, 100));
		expect(metricsHub.streams).toBe(0);
		expect(fetch.mock.calls.length).toBe(calls);
		expect(open()).toHaveLength(0);
		unmount();
	});

	it('releases everything while the page is hidden', async () => {
		metricsInterval.set(100);
		const { unmount } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await hf().click();
		await expectStream(100);
		const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.waitFor(() => expect(metricsHub.streams).toBe(0));
		hidden.mockRestore();
		document.dispatchEvent(new Event('visibilitychange'));
		setWindowFocus(true);
		await expectStream(100);
		unmount();
	});

	it('without IntersectionObserver never samples faster than standby', async () => {
		vi.stubGlobal('IntersectionObserver', undefined);
		metricsInterval.set(100);
		const { unmount } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await hf().click();
		await expect.element(hf()).toHaveAttribute('aria-checked', 'true');
		await expectStream(5000);
		await expect
			.element(cadence())
			.toHaveTextContent('(chart visibility unavailable in this browser)');
		unmount();
	});

	it('a stored-history view detaches the live chart: standby, never 100 ms, one history read', async () => {
		const history = {
			enabled: true,
			intervalSeconds: 60,
			retentionDays: 7,
			resolutionSeconds: 120,
			items: [
				{
					sampledAt: Math.floor(Date.now() / 1000) - 600,
					cpuPercent: 4,
					memoryWorkingSetBytes: GiB,
					memoryLimitBytes: 2 * GiB
				}
			]
		};
		const fetch = vi.fn(async (path: string) =>
			path.includes('/metrics/history') ? json(history) : json(sample())
		);
		vi.stubGlobal('fetch', fetch);
		metricsInterval.set(100);
		const { unmount } = render(ServerMetrics, { serverId: 's1', serverState: 'running' });
		await hf().click();
		await expectStream(100);

		await page.getByRole('button', { name: '24h' }).click();
		await expect.element(page.getByTestId('stored-history-charts')).toBeVisible();
		// The live observer is gone: the shared sampler drops to standby for the header.
		await expectStream(5000);
		await expect.element(page.getByTestId('metrics-state')).toHaveAttribute('data-mode', 'history');
		await expect.element(page.getByTestId('stored-history-note')).toHaveTextContent('kept 7 days');
		const historyCalls = () =>
			fetch.mock.calls.filter(([path]) => String(path).includes('/metrics/history'));
		await new Promise((r) => setTimeout(r, 300));
		expect(historyCalls().map(([path]) => path)).toEqual([
			'/api/v1/servers/s1/metrics/history?hours=24'
		]);
		expect(open().every((s) => !s.url.endsWith('intervalMs=100'))).toBe(true);

		await page.getByRole('button', { name: '7d' }).click();
		await vi.waitFor(() => expect(historyCalls()).toHaveLength(2));
		expect(historyCalls()[1][0]).toBe('/api/v1/servers/s1/metrics/history?hours=168');

		// Back to Live: the session High frequency choice applies again while attended.
		await page.getByRole('button', { name: 'Live' }).click();
		await expectStream(100);
		unmount();
		expect(metricsHub.streams).toBe(0);
	});
});
