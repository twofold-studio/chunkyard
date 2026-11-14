import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Job, JobPage } from '#lib/api/index.js';
import { job } from '#lib/jobs/jobs.fixture.js';
import ActivityView from './activity-view.svelte';
import JobDetail from './job-detail.svelte';

const at = (id: string, minute: number, extra: Partial<Job> = {}) =>
	job(id, { createdAt: `2026-11-14T10:${String(minute).padStart(2, '0')}:00Z`, ...extra });
const servers = [{ id: 'srv-1', name: 'Survival' }];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => vi.unstubAllGlobals());

describe('ActivityView', () => {
	it('lists jobs with human names, server names and sanitized failures', async () => {
		const initial: JobPage = {
			items: [
				at('j3', 3, { kind: 'server.export', state: 'running', finishedAt: null }),
				at('j2', 2, {
					kind: 'java.install',
					serverId: null,
					state: 'failed',
					error: { code: 'java.download', detail: 'mirror\u0007 timed out' }
				}),
				at('j1', 1, { serverId: 'gone', kind: 'server.delete' })
			],
			nextCursor: null
		};
		const getJob = vi.fn().mockResolvedValue(initial.items[0]);
		render(ActivityView, { initial, servers, feedOptions: { getJob, intervalMs: 60_000 } });

		const rows = page.getByTestId('job-row');
		await expect.element(rows.first()).toHaveTextContent('Export server');
		await expect.element(rows.first()).toHaveTextContent('Survival');
		await expect.element(rows.first()).toHaveTextContent('Running');
		await expect.element(rows.nth(1)).toHaveTextContent('Install Java runtime');
		await expect.element(rows.nth(1)).toHaveTextContent('Manager');
		await expect.element(rows.nth(1)).toHaveTextContent('mirror timed out');
		await expect.element(rows.nth(2)).toHaveTextContent('Deleted server');
		expect(rows.first().element().getAttribute('href')).toMatch(/\/activity\/j3$/);
		await expect.element(page.getByText('Start of job history.')).toBeVisible();
		// No fake percentages or cancel controls.
		expect(document.body.textContent).not.toMatch(/\d+\s?%/);
		expect(page.getByRole('button', { name: /cancel/i }).elements()).toHaveLength(0);
	});

	it('server-scoped view fetches its own pages with the server filter', async () => {
		const listJobs = vi
			.fn()
			.mockResolvedValueOnce({
				items: [at('s2', 2, { kind: 'server.install', state: 'running', finishedAt: null })],
				nextCursor: 'cur-s'
			})
			.mockResolvedValueOnce({ items: [at('s1', 1, { kind: 'server.export' })], nextCursor: null });
		const getJob = vi.fn();
		render(ActivityView, {
			initial: null,
			servers,
			serverId: 'srv-1',
			feedOptions: { listJobs, getJob, intervalMs: 60_000 }
		});
		const rows = page.getByTestId('job-row');
		await expect.element(rows.first()).toHaveTextContent('Install server software');
		// Scope is implicit: no server picker and no server name per row.
		expect(page.getByRole('combobox', { name: 'Filter by server' }).elements()).toHaveLength(0);
		await expect.element(rows.first()).not.toHaveTextContent('Survival');
		await page.getByRole('button', { name: 'Load older jobs' }).click();
		await expect.element(rows.nth(1)).toHaveTextContent('Export server');
		expect(listJobs.mock.calls.map(([o]) => [o.serverId, o.cursor ?? null])).toEqual([
			['srv-1', null],
			['srv-1', 'cur-s']
		]);
		expect(rows.first().element().getAttribute('href')).toMatch(/\/activity\/s2$/);
	});

	it('loads older pages with the cursor', async () => {
		const listJobs = vi.fn().mockResolvedValue({ items: [at('old', 0)], nextCursor: null });
		render(ActivityView, {
			initial: { items: [at('new', 5)], nextCursor: 'cur-1' },
			servers,
			feedOptions: { listJobs }
		});
		await page.getByRole('button', { name: 'Load older jobs' }).click();
		await expect.element(page.getByTestId('job-row').nth(1)).toBeVisible();
		expect(listJobs).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'cur-1', limit: 50 }));
		await expect.element(page.getByTestId('jobs-count')).toHaveTextContent('2 loaded');
		await expect
			.element(page.getByRole('button', { name: 'Load older jobs' }))
			.not.toBeInTheDocument();
	});

	it('filters loaded jobs by state and labels the scope', async () => {
		render(ActivityView, {
			initial: {
				items: [at('a', 2, { state: 'failed', error: { code: 'x', detail: 'bad' } }), at('b', 1)],
				nextCursor: 'more'
			},
			servers
		});
		await page.getByRole('combobox', { name: 'Filter by state' }).click();
		await page.getByRole('option', { name: 'Failed' }).click();
		await expect.element(page.getByTestId('jobs-count')).toHaveTextContent('1 of 2 loaded');
		await expect
			.element(page.getByText(/Filters apply only to jobs loaded in this view/))
			.toBeVisible();
		await expect.element(page.getByTestId('job-row')).toHaveTextContent('Failed');
		await page.getByRole('button', { name: 'Clear filters' }).click();
		await expect.element(page.getByTestId('jobs-count')).toHaveTextContent('2 loaded');
	});

	it('refreshes running jobs until they finish and stops polling on unmount', async () => {
		const running = at('r', 3, { state: 'running', finishedAt: null });
		const getJob = vi
			.fn()
			.mockResolvedValueOnce(running)
			.mockResolvedValue({ ...running, state: 'succeeded', finishedAt: '2026-11-14T10:04:00Z' });
		const view = render(ActivityView, {
			initial: { items: [running], nextCursor: null },
			servers,
			feedOptions: { getJob, intervalMs: 5 }
		});
		await expect.element(page.getByTestId('job-row')).toHaveTextContent('Succeeded');
		const calls = getJob.mock.calls.length;
		await sleep(40);
		expect(getJob.mock.calls.length).toBe(calls); // finished: no more requests

		const again = vi.fn().mockResolvedValue(running);
		view.unmount();
		const second = render(ActivityView, {
			initial: { items: [running], nextCursor: null },
			servers,
			feedOptions: { getJob: again, intervalMs: 5 }
		});
		await vi.waitFor(() => expect(again).toHaveBeenCalled());
		second.unmount();
		const after = again.mock.calls.length;
		await sleep(40);
		expect(again.mock.calls.length).toBe(after);
	});
});

describe('JobDetail', () => {
	it('shows an allowlisted result and links only to an existing server', async () => {
		render(JobDetail, {
			job: at('e', 1, {
				kind: 'server.export',
				result: {
					fileName: 'survival.tar.gz',
					scope: 'world',
					destination: 'local',
					size: 4096,
					sha256: 'cd'.repeat(32),
					secretAccessKey: 'nope'
				}
			}),
			servers
		});
		await expect.element(page.getByTestId('job-summary')).toHaveTextContent('survival.tar.gz');
		await expect.element(page.getByRole('link', { name: 'Open Survival' })).toBeVisible();
		expect(document.body.textContent).not.toContain('nope');
	});

	it('does not link a deleted server and shows the failure code', async () => {
		render(JobDetail, {
			job: at('d', 1, {
				kind: 'server.start',
				serverId: 'gone',
				state: 'failed',
				error: { code: 'server.eula_required', detail: 'Accept the EULA.' }
			}),
			servers
		});
		await expect.element(page.getByTestId('job-failure')).toHaveTextContent('server.eula_required');
		expect(page.getByRole('link', { name: /Open/ }).elements()).toHaveLength(0);
	});

	it('shows observed export steps while running and where a job stopped', async () => {
		const work = {
			stage: 'compress' as const,
			completedBytes: 3 * 1024 * 1024,
			totalBytes: null,
			completedStages: ['scan' as const]
		};
		const running = at('w', 1, { kind: 'server.export', state: 'running', finishedAt: null, work });
		const getJob = vi.fn().mockResolvedValue({
			...running,
			state: 'failed',
			error: { code: 'job.interrupted', detail: 'Restarted.' }
		});
		render(JobDetail, { job: running, servers, getJob, intervalMs: 5 });
		await expect.element(page.getByTestId('job-progress')).toHaveTextContent('3.0 MiB written');
		await expect.element(page.getByText('Interrupted during compressing')).toBeVisible();
		expect(document.body.textContent).not.toMatch(/\d+\s*%/);
	});

	it('shows no step list for an old finished job without observations', async () => {
		render(JobDetail, { job: at('o', 1, { kind: 'server.install', work: null }), servers });
		await expect.element(page.getByText('Succeeded')).toBeVisible();
		expect(page.getByTestId('work-progress').elements()).toHaveLength(0);
	});

	it('polls a running job until it finishes, then stops', async () => {
		const running = at('r', 1, { state: 'running', finishedAt: null, message: 'Downloading' });
		const getJob = vi
			.fn()
			.mockResolvedValueOnce(running)
			.mockResolvedValue({ ...running, state: 'succeeded', message: null });
		render(JobDetail, { job: running, servers, getJob, intervalMs: 5 });
		await expect.element(page.getByTestId('job-progress')).toHaveTextContent('Downloading');
		await expect.element(page.getByText('Succeeded')).toBeVisible();
		const calls = getJob.mock.calls.length;
		await sleep(40);
		expect(getJob.mock.calls.length).toBe(calls);
	});
});
