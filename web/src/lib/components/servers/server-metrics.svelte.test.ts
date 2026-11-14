import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServerMetrics from './server-metrics.svelte';
import { METRICS_INTERVAL_KEY, metricsInterval } from '#lib/metrics-interval.svelte.js';

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

afterEach(() => {
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
		for (const id of ['metric-cpu', 'metric-memory', 'metric-uptime']) {
			await expect.element(page.getByTestId(id)).toHaveTextContent('—');
		}
		const section = page.getByRole('region', { name: 'Resources' }).element();
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
		await expect.element(page.getByText('of one core · limit 2 cores')).toBeVisible();
		await expect.element(page.getByTestId('metric-memory')).toHaveTextContent('1.5 GiB');
		await expect.element(page.getByTestId('metric-uptime')).toHaveTextContent('1h 2m');
		await expect
			.element(page.getByRole('meter', { name: 'CPU of limit' }))
			.toHaveAttribute('aria-valuenow', '100');
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
		metricsInterval.set(1);
		expect(localStorage.getItem(METRICS_INTERVAL_KEY)).toBe('1');
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
			metricsInterval.set(1);
			let n = 0;
			const fetch = vi.fn(async () => json(at(n * 1000, { cpuPercent: 10 + 10 * n++ })));
			vi.stubGlobal('fetch', fetch);
			const { unmount } = render(ServerMetrics, {
				serverId: 's1',
				serverState: 'running',
				cpus: 2
			});
			const history = page.getByTestId('metrics-history');
			await expect.element(history).toHaveTextContent('History collected while this view is open');
			await expect.element(history).toHaveTextContent('not stored');
			await vi.waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2), {
				timeout: 4000
			});
			const cpu = page.getByRole('img', { name: /^CPU over/ });
			await expect
				.element(cpu)
				.toHaveAttribute('aria-label', expect.stringMatching(/lowest 10\.0%/));
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
});
