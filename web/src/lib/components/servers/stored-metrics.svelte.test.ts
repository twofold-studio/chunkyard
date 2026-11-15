import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import StoredMetrics from './stored-metrics.svelte';
import { ApiError, type MetricsHistory } from '#lib/api/index.js';
import { DocumentAttention } from '#lib/attention.svelte.js';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const S = NOW / 1000;
const MiB = 1024 ** 2;

const history = (extra: Partial<MetricsHistory> = {}): MetricsHistory => ({
	enabled: true,
	intervalSeconds: 60,
	retentionDays: 7,
	resolutionSeconds: 120,
	items: [],
	...extra
});

function attention(attentive: boolean) {
	const a = new DocumentAttention();
	a.visible = attentive;
	a.focused = attentive;
	return a;
}

describe('StoredMetrics', () => {
	it('charts stored buckets with real gaps and never invents zeros', async () => {
		const fetch = vi.fn(async () =>
			history({
				items: [
					{
						sampledAt: S - 3000,
						cpuPercent: 10,
						memoryWorkingSetBytes: 300 * MiB,
						memoryLimitBytes: 1024 * MiB
					},
					{
						sampledAt: S - 2880,
						cpuPercent: 12,
						memoryWorkingSetBytes: 310 * MiB,
						memoryLimitBytes: 1024 * MiB
					},
					// Missing CPU in this bucket: a break, not 0%.
					{
						sampledAt: S - 2760,
						cpuPercent: null,
						memoryWorkingSetBytes: 320 * MiB,
						memoryLimitBytes: null
					},
					// Long pause (stopped): a gap, not a bridged line.
					{
						sampledAt: S - 600,
						cpuPercent: 20,
						memoryWorkingSetBytes: 400 * MiB,
						memoryLimitBytes: 1024 * MiB
					},
					{
						sampledAt: S - 480,
						cpuPercent: 22,
						memoryWorkingSetBytes: 410 * MiB,
						memoryLimitBytes: 1024 * MiB
					}
				]
			})
		);
		render(StoredMetrics, {
			serverId: 's1',
			hours: 1,
			fetch,
			attention: attention(true),
			now: () => NOW
		});
		const charts = page.getByTestId('stored-history-charts');
		await expect.element(charts).toBeVisible();
		const cpu = page.getByRole('img', { name: /^CPU over the last hour/ });
		await expect.element(cpu).toHaveAttribute('data-runs', '2');
		await expect
			.element(cpu)
			.toHaveAccessibleName(/4 samples.*lowest 10\.0%.*highest 22\.0%.*1 gap/);
		const memory = page.getByRole('img', { name: /^Memory/ });
		await expect.element(memory).toHaveAttribute('data-runs', '2');
		expect(charts.element().textContent).not.toMatch(/\b0(\.0)?\s?(%|B)\b/);
		await expect
			.element(page.getByTestId('stored-history-note'))
			.toHaveTextContent(
				/every 1 minute while running, kept 7 days\. Each point averages the snapshots in a 2-minute bucket/
			);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith('s1', 1, expect.any(AbortSignal));
	});

	it('shows the disabled and empty states without fabricated points', async () => {
		const onOpenSettings = vi.fn();
		render(StoredMetrics, {
			serverId: 's1',
			hours: 24,
			fetch: async () => history({ enabled: false }),
			attention: attention(true),
			onOpenSettings,
			now: () => NOW
		});
		await expect
			.element(page.getByTestId('stored-history-disabled'))
			.toHaveTextContent('History collection is off for this server.');
		await expect
			.element(page.getByTestId('stored-history-empty'))
			.toHaveTextContent('No snapshots in the last 24h');
		await expect.element(page.getByTestId('stored-history-charts')).not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Turn on in Settings' }).click();
		expect(onOpenSettings).toHaveBeenCalledOnce();
	});

	it('reports a failed read with a retry', async () => {
		const fetch = vi
			.fn()
			.mockRejectedValueOnce(new ApiError(500, 'operations.storage', 'nope'))
			.mockResolvedValueOnce(history());
		render(StoredMetrics, { serverId: 's1', hours: 168, fetch, attention: attention(true) });
		await expect.element(page.getByText(/Could not save the setting|Request failed/)).toBeVisible();
		await page.getByRole('button', { name: 'Retry' }).click();
		await expect.element(page.getByTestId('stored-history-empty')).toHaveTextContent('7d');
		expect(fetch).toHaveBeenLastCalledWith('s1', 168, expect.any(AbortSignal));
	});

	it('refreshes at most on its slow cadence and only while attended', async () => {
		const fetch = vi.fn(async () => history());
		const attended = attention(false);
		const { unmount } = render(StoredMetrics, {
			serverId: 's1',
			hours: 1,
			fetch,
			attention: attended,
			refreshMs: 1000
		});
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		await new Promise((r) => setTimeout(r, 1300));
		expect(fetch).toHaveBeenCalledTimes(1);
		attended.visible = true;
		attended.focused = true;
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2), { timeout: 2500 });
		unmount();
		const calls = fetch.mock.calls.length;
		await new Promise((r) => setTimeout(r, 1200));
		expect(fetch).toHaveBeenCalledTimes(calls);
	});
});
