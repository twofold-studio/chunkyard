import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Job } from '#lib/api/index.js';
import { job } from '#lib/jobs/jobs.fixture.js';
import JobWorkProgress from './job-work-progress.svelte';

const MiB = 1024 * 1024;
const withWork = (work: unknown, extra: Partial<Job> = {}) =>
	job('j', {
		kind: 'server.export',
		state: 'running',
		progress: null,
		finishedAt: null,
		work: work as Job['work'],
		...extra
	});

afterEach(() => vi.unstubAllGlobals());

describe('JobWorkProgress', () => {
	it('shows a determinate stage bar only with a known total', async () => {
		render(JobWorkProgress, {
			job: withWork({
				stage: 'upload',
				completedBytes: 40 * MiB,
				totalBytes: 95 * MiB,
				completedStages: ['scan', 'compress']
			})
		});
		const bar = page.getByRole('progressbar');
		await expect.element(bar).toHaveAttribute('aria-valuenow', '42');
		await expect.element(page.getByTestId('work-percent')).toHaveTextContent('42%');
		await expect.element(page.getByText('Uploading to storage')).toBeVisible();
		await expect
			.element(page.getByTestId('work-bytes'))
			.toHaveTextContent('40.0 MiB of 95.0 MiB sent');
		await expect
			.element(page.getByTestId('work-history'))
			.toHaveTextContent(/Scan.*Compress.*Upload/);
	});

	it('shows indeterminate progress with bytes produced while compressing', async () => {
		render(JobWorkProgress, {
			job: withWork({
				stage: 'compress',
				completedBytes: 12 * MiB,
				totalBytes: null,
				completedStages: ['scan']
			})
		});
		const bar = page.getByRole('progressbar');
		await expect.element(bar).not.toHaveAttribute('aria-valuenow');
		await expect.element(bar).toHaveAttribute('aria-valuetext', 'Compressing, 12.0 MiB written');
		expect(page.getByTestId('work-percent').elements()).toHaveLength(0);
		expect(document.body.textContent).not.toMatch(/\d+\s*%/);
	});

	it('shows repeated steps once with a count and notes truncated history', async () => {
		const stages = Array.from({ length: 32 }, (_, i) => (i % 2 ? 'verify' : 'download'));
		render(JobWorkProgress, {
			job: withWork(
				{ stage: 'download', completedBytes: null, totalBytes: null, completedStages: stages },
				{ kind: 'server.install' }
			)
		});
		await expect.element(page.getByText('Earlier steps not shown')).toBeVisible();
		await expect
			.element(page.getByTestId('work-history').getByRole('listitem').last())
			.toHaveAttribute('aria-current', 'step');

		render(JobWorkProgress, {
			job: withWork(
				{
					stage: 'finalize',
					completedBytes: null,
					totalBytes: null,
					completedStages: ['download', 'download', 'download']
				},
				{ id: 'k', kind: 'server.install' }
			)
		});
		await expect.element(page.getByTitle('Observed 3 times')).toHaveTextContent('×3');
	});

	it('lets queued state win: no bar, no bytes', async () => {
		render(JobWorkProgress, {
			job: withWork(
				{ stage: 'download', completedBytes: 10, totalBytes: 100, completedStages: [] },
				{ state: 'queued', startedAt: null }
			)
		});
		await expect.element(page.getByText(/^Queued/)).toBeVisible();
		expect(page.getByRole('progressbar').elements()).toHaveLength(0);
		expect(page.getByTestId('work-bytes').elements()).toHaveLength(0);
	});

	it('shows where a failed or interrupted job stopped, without a bar', async () => {
		render(JobWorkProgress, {
			job: withWork(
				{
					stage: 'verify_upload',
					completedBytes: 5 * MiB,
					totalBytes: 95 * MiB,
					completedStages: ['scan', 'compress', 'upload']
				},
				{ state: 'failed', error: { code: 'job.interrupted', detail: 'Restarted.' } }
			)
		});
		await expect
			.element(page.getByText('Interrupted during verifying upload (checksum read-back)'))
			.toBeVisible();
		await expect.element(page.getByText('Verify upload (stopped)')).toBeVisible();
		expect(page.getByRole('progressbar').elements()).toHaveLength(0);
		expect(page.getByTestId('work-percent').elements()).toHaveLength(0);
	});

	it('shows success as complete with every observed step checked', async () => {
		render(JobWorkProgress, {
			job: withWork(
				{
					stage: 'finalize',
					completedBytes: null,
					totalBytes: null,
					completedStages: ['scan', 'compress', 'upload', 'verify_upload']
				},
				{ state: 'succeeded', progress: 1 }
			)
		});
		await expect.element(page.getByText('Completed')).toBeVisible();
		await expect
			.element(page.getByTestId('work-history'))
			.toHaveTextContent(/Verify upload.*Finalize/);
		expect(page.getByRole('progressbar').elements()).toHaveLength(0);
	});

	it('falls back safely for old or malformed observations and never fetches', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		render(JobWorkProgress, {
			job: withWork({ stage: 42, completedStages: 'x' }),
			fallback: 'Exporting'
		});
		await expect.element(page.getByText('Exporting')).toBeVisible();
		await expect.element(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
		expect(page.getByTestId('work-history').elements()).toHaveLength(0);
		expect(fetch).not.toHaveBeenCalled();
	});
});
