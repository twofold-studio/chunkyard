import { describe, expect, it, vi } from 'vitest';
import type { Job, JobPage } from '#lib/api/index.js';
import { waitForJob } from '#lib/api/jobs.js';
import { BackupOperations } from './backup-operations.svelte.js';

const job = (id: string, kind: string, state: Job['state'], extra: Partial<Job> = {}): Job => ({
	id,
	kind,
	serverId: 's1',
	state,
	progress: null,
	message: null,
	error: null,
	result: null,
	createdBy: null,
	createdAt: '',
	startedAt: null,
	finishedAt: null,
	...extra
});

function make(getJob: (id: string) => Promise<Job>, extra = {}) {
	const onSettled = vi.fn();
	const ops = new BackupOperations({
		intervalMs: 1,
		onSettled,
		api: {
			waitForJob: (initial, options) =>
				waitForJob(initial, { ...options, fetchJob: (id) => getJob(id) }),
			...extra
		}
	});
	return { ops, onSettled };
}

describe('BackupOperations', () => {
	it('restores by export ID, tracks the job per server and refreshes once when done', async () => {
		const restoreExport = vi.fn().mockResolvedValue({ job: job('r1', 'server.restore', 'queued') });
		const { ops, onSettled } = make(
			vi
				.fn()
				.mockResolvedValue(job('r1', 'server.restore', 'succeeded', { result: { server: {} } })),
			{ restoreExport }
		);
		const pending = ops.restore('s1', 'e1');
		expect(ops.busy('s1')).toBe(true);
		const final = await pending;
		expect(final?.state).toBe('succeeded');
		expect(restoreExport).toHaveBeenCalledWith('e1', expect.anything());
		expect(ops.busy('s1')).toBe(false);
		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(ops.errors.has('s1')).toBe(false);
	});

	it('keeps failures per server so restore can be retried', async () => {
		const restoreExport = vi
			.fn()
			.mockRejectedValueOnce({ code: 'exports.restore_conflict', detail: 'exists' })
			.mockResolvedValueOnce({ job: job('r2', 'server.restore', 'running') });
		const { ops, onSettled } = make(
			vi.fn().mockResolvedValue(
				job('r2', 'server.restore', 'failed', {
					error: { code: 'exports.invalid_archive', detail: 'bad' }
				})
			),
			{ restoreExport }
		);
		await ops.restore('s1', 'e1');
		expect(ops.errors.get('s1')).toEqual({ code: 'exports.restore_conflict', detail: 'exists' });
		expect(onSettled).not.toHaveBeenCalled();
		await ops.restore('s1', 'e1');
		expect(ops.errors.get('s1')).toEqual({ code: 'exports.invalid_archive', detail: 'bad' });
		expect(onSettled).toHaveBeenCalledTimes(1);
	});

	it('recovers only active archive/restore jobs with one bounded request', async () => {
		const listJobs = vi.fn().mockResolvedValue({
			items: [
				job('a1', 'server.archive', 'running', { serverId: 's1' }),
				job('x1', 'server.export', 'running', { serverId: 's2' }),
				job('r1', 'server.restore', 'queued', { serverId: 's3' })
			],
			nextCursor: null
		} satisfies JobPage);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const getJob = vi.fn(async (id: string) => {
			await gate;
			return job(id, id.startsWith('a') ? 'server.archive' : 'server.restore', 'succeeded');
		});
		const { ops, onSettled } = make(getJob, { listJobs });
		await ops.recover();
		expect(listJobs).toHaveBeenCalledWith(
			expect.objectContaining({ activeOnly: true, limit: 200 })
		);
		expect(ops.busy('s1')).toBe(true);
		expect(ops.busy('s2')).toBe(false);
		expect(ops.busy('s3')).toBe(true);
		release();
		await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(2));
		expect(ops.busy('s1')).toBe(false);
	});

	it('reports discovery failures instead of claiming nothing runs', async () => {
		const { ops } = make(vi.fn(), { listJobs: vi.fn().mockRejectedValue(new Error('down')) });
		await ops.recover();
		expect(ops.recoveryError).toBeInstanceOf(Error);
	});
});
