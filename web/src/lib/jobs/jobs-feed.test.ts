import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobPage } from '#lib/api/index.js';
import { ActivityIndicator, INDICATOR_THROTTLE_MS } from './activity-indicator.svelte';
import { JobsFeed } from './jobs-feed.svelte';
import { job } from './jobs.fixture';

const page = (items: Job[], nextCursor: string | null = null): JobPage => ({ items, nextCursor });
const at = (id: string, minute: number, extra: Partial<Job> = {}) =>
	job(id, { createdAt: `2026-11-14T10:${String(minute).padStart(2, '0')}:00Z`, ...extra });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let feeds: JobsFeed[] = [];
afterEach(() => {
	for (const feed of feeds) feed.destroy();
	feeds = [];
});
function make(...args: ConstructorParameters<typeof JobsFeed>) {
	const feed = new JobsFeed(...args);
	feeds.push(feed);
	return feed;
}

describe('JobsFeed pagination', () => {
	it('appends older pages with the cursor and ignores overlapping loads', async () => {
		let release!: (p: JobPage) => void;
		const listJobs = vi.fn(
			() =>
				new Promise<JobPage>((resolve) => {
					release = resolve;
				})
		);
		const feed = make(page([at('b', 2), at('a', 1)], 'cur-1'), { listJobs, pageSize: 2 });

		const first = feed.loadMore();
		void feed.loadMore(); // ignored while in flight
		expect(listJobs).toHaveBeenCalledTimes(1);
		expect(listJobs.mock.calls[0]).toEqual([
			expect.objectContaining({ limit: 2, cursor: 'cur-1' })
		]);
		expect(feed.loadingMore).toBe(true);

		release(page([at('a', 1), at('z', 0)], null));
		await first;
		expect(feed.items.map((j) => j.id)).toEqual(['b', 'a', 'z']);
		expect(feed.nextCursor).toBeNull();
		expect(feed.loadingMore).toBe(false);

		await feed.loadMore(); // end of history: no request
		expect(listJobs).toHaveBeenCalledTimes(1);
	});

	it('keeps loaded jobs and reports the error when a page fails', async () => {
		const listJobs = vi.fn().mockRejectedValue(new Error('boom'));
		const feed = make(page([at('a', 1)], 'cur'), { listJobs });
		await feed.loadMore();
		expect(feed.items).toHaveLength(1);
		expect(feed.nextCursor).toBe('cur');
		expect(feed.error).toBeInstanceOf(Error);
	});

	it('refresh merges the newest page without losing the cursor', async () => {
		const listJobs = vi.fn().mockResolvedValue(page([at('c', 3), at('b', 2)], 'other'));
		const feed = make(page([at('b', 2), at('a', 1)], 'cur'), { listJobs });
		await feed.refresh();
		expect(feed.items.map((j) => j.id)).toEqual(['c', 'b', 'a']);
		expect(feed.nextCursor).toBe('cur');
		expect(listJobs.mock.calls[0][0]).not.toHaveProperty('cursor');
	});
});

describe('JobsFeed polling', () => {
	it('re-fetches only queued/running jobs and stops when they finish', async () => {
		const running = at('r', 3, { state: 'running', finishedAt: null });
		const getJob = vi
			.fn()
			.mockResolvedValueOnce(running)
			.mockResolvedValueOnce({
				...running,
				state: 'succeeded',
				finishedAt: '2026-11-14T10:04:00Z'
			});
		const onChange = vi.fn();
		const feed = make(page([running, at('done', 1)]), { getJob, intervalMs: 5, onChange });
		feed.start();
		feed.start(); // idempotent: still one loop
		await vi.waitFor(() => expect(feed.active).toHaveLength(0));
		expect(getJob).toHaveBeenCalledTimes(2);
		expect(getJob.mock.calls.every(([id]) => id === 'r')).toBe(true);
		expect(onChange).toHaveBeenCalled();
		await tick(40);
		expect(getJob).toHaveBeenCalledTimes(2); // nothing active: no requests
	});

	it('never overlaps refresh requests', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const running = at('r', 3, { state: 'running', finishedAt: null });
		const getJob = vi.fn(async () => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await tick(15);
			inFlight--;
			return running;
		});
		const feed = make(page([running]), { getJob, intervalMs: 1 });
		feed.start();
		await vi.waitFor(() => expect(getJob.mock.calls.length).toBeGreaterThanOrEqual(3));
		expect(maxInFlight).toBe(1);
	});

	it('pauses while hidden and stops after destroy', async () => {
		let visible = false;
		const running = at('r', 3, { state: 'running', finishedAt: null });
		const getJob = vi.fn().mockResolvedValue(running);
		const feed = make(page([running]), { getJob, intervalMs: 2, isVisible: () => visible });
		feed.start();
		await tick(30);
		expect(getJob).not.toHaveBeenCalled();
		visible = true;
		await vi.waitFor(() => expect(getJob).toHaveBeenCalled());
		feed.destroy();
		const count = getJob.mock.calls.length;
		await tick(30);
		expect(getJob.mock.calls.length).toBe(count);
	});
});

describe('ActivityIndicator', () => {
	it('counts active jobs and throttles idle checks', async () => {
		let now = 1000;
		const fetchPage = vi.fn().mockResolvedValue(page([at('a', 1, { state: 'succeeded' })], null));
		const indicator = new ActivityIndicator(fetchPage, () => now);
		await indicator.check();
		expect(indicator.active).toBe(0);
		await indicator.check();
		expect(fetchPage).toHaveBeenCalledTimes(1);
		now += INDICATOR_THROTTLE_MS + 1;
		await indicator.check();
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it('re-checks promptly while jobs are active and accepts observed lists', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValue(page([at('q', 1, { state: 'queued', startedAt: null })]));
		const indicator = new ActivityIndicator(fetchPage, () => 0);
		await indicator.check();
		expect(indicator.active).toBe(1);
		await indicator.check();
		expect(fetchPage).toHaveBeenCalledTimes(2);
		indicator.observe([at('a', 1)]);
		expect(indicator.active).toBe(0);
	});

	it('leaves the count unchanged on failure', async () => {
		const indicator = new ActivityIndicator(vi.fn().mockRejectedValue(new Error('x')), () => 0);
		await indicator.check();
		expect(indicator.active).toBeNull();
	});
});
