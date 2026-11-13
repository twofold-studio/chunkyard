import { describe, expect, it, vi } from 'vitest';
import type { Job } from '#lib/api/index.js';
import { deleteAndWait, deletedFromResult } from './delete';

const job = (state: Job['state'], extra: Partial<Job> = {}): Job => ({
	id: 'job-d',
	kind: 'server.delete',
	serverId: 'srv-1',
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

describe('deleteAndWait', () => {
	it('passes deleteFiles through and reads the retained directory', async () => {
		const deleteServer = vi.fn().mockResolvedValue({ job: job('queued') });
		const waitForJob = vi.fn().mockResolvedValue(
			job('succeeded', {
				result: { deleted: { id: 'srv-1', filesDeleted: false, retainedDirectory: '/data/srv-1' } }
			})
		);
		const outcome = await deleteAndWait('srv-1', false, { api: { deleteServer, waitForJob } });
		expect(deleteServer).toHaveBeenCalledWith('srv-1', false, expect.anything());
		expect(outcome.error).toBeNull();
		expect(outcome.deleted).toEqual({
			id: 'srv-1',
			filesDeleted: false,
			retainedDirectory: '/data/srv-1'
		});
	});

	it('reports a failed job without a deleted result', async () => {
		const failure = { code: 'docker.unavailable', detail: 'No engine.' };
		const outcome = await deleteAndWait('srv-1', true, {
			api: {
				deleteServer: vi.fn().mockResolvedValue({ job: job('queued') }),
				waitForJob: vi.fn().mockResolvedValue(job('failed', { error: failure }))
			}
		});
		expect(outcome.deleted).toBeNull();
		expect(outcome.error).toEqual(failure);
	});

	it('ignores a result for a different server', () => {
		expect(
			deletedFromResult(
				{ deleted: { id: 'other', filesDeleted: true, retainedDirectory: null } },
				'srv-1'
			)
		).toBeNull();
	});
});
