import type { Job } from '#lib/api/index.js';

export const job = (id: string, extra: Partial<Job> = {}): Job => ({
	work: null,
	id,
	kind: 'server.start',
	serverId: 'srv-1',
	state: 'succeeded',
	progress: 1,
	message: null,
	error: null,
	result: null,
	createdBy: null,
	createdAt: '2026-11-14T10:00:00Z',
	startedAt: '2026-11-14T10:00:01Z',
	finishedAt: '2026-11-14T10:00:04Z',
	...extra
});
