import { describe, expect, it, vi } from 'vitest';
import { waitForJob } from './jobs';
import type { Job } from './types';

const job = (state: Job['state'], extra: Partial<Job> = {}): Job => ({
	work: null,
	id: 'j1',
	kind: 'java.install',
	serverId: null,
	state,
	progress: state === 'succeeded' ? 1 : null,
	message: null,
	error: null,
	result: null,
	createdBy: null,
	createdAt: '',
	startedAt: null,
	finishedAt: null,
	...extra
});

describe('waitForJob', () => {
	it('polls until the job leaves queued/running and reports each update', async () => {
		const fetchJob = vi
			.fn()
			.mockResolvedValueOnce(job('running'))
			.mockResolvedValueOnce(job('succeeded', { result: { runtime: {} } }));
		const updates: string[] = [];
		const final = await waitForJob(job('queued'), {
			intervalMs: 1,
			fetchJob,
			onUpdate: (j) => updates.push(j.state)
		});
		expect(final.state).toBe('succeeded');
		expect(final.progress).toBe(1);
		expect(updates).toEqual(['queued', 'running', 'succeeded']);
		expect(fetchJob).toHaveBeenCalledTimes(2);
	});

	it('returns failed jobs with their error instead of throwing', async () => {
		const fetchJob = vi
			.fn()
			.mockResolvedValue(job('failed', { error: { code: 'server.jar_missing', detail: 'x' } }));
		const final = await waitForJob(job('running'), { intervalMs: 1, fetchJob });
		expect(final.error?.code).toBe('server.jar_missing');
	});

	it('does not poll a job that is already finished', async () => {
		const fetchJob = vi.fn();
		await waitForJob(job('succeeded'), { fetchJob });
		expect(fetchJob).not.toHaveBeenCalled();
	});

	it('stops when aborted', async () => {
		const controller = new AbortController();
		const fetchJob = vi.fn().mockResolvedValue(job('running'));
		const pending = waitForJob(job('running'), {
			intervalMs: 5,
			fetchJob,
			signal: controller.signal
		});
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(fetchJob).not.toHaveBeenCalled();
	});
});
