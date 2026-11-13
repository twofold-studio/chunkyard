import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Job, type ServerView } from '#lib/api/index.js';
import { CreateServerFlow } from './create-flow.svelte.js';

const server = (extra: Partial<ServerView> = {}): ServerView => ({
	id: 's1',
	name: 'Survival',
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'eclipse-temurin:21-jre',
	port: 25565,
	memoryMinMb: 512,
	memoryMaxMb: 2048,
	cpus: 2,
	acceptEula: false,
	directory: '/srv/s1',
	status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
	software: { type: 'vanilla', version: '1.21.1' },
	launch: null,
	...extra
});

const job = (state: Job['state'], extra: Partial<Job> = {}): Job => ({
	id: 'j1',
	kind: 'server.install',
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

const request = {
	name: 'Survival',
	port: 25565,
	software: { type: 'vanilla' as const, version: '1.21.1' }
};

describe('CreateServerFlow', () => {
	it('creates once and retries a failed install on the same record', async () => {
		const installed = server({
			launch: { path: 'server.jar', version: '1.21.1', build: null, javaMajor: 21, checksum: 'x' }
		});
		const createServer = vi.fn().mockResolvedValue({ server: server() });
		const installServer = vi.fn().mockResolvedValue({ job: job('queued') });
		const waitForJob = vi
			.fn()
			.mockResolvedValueOnce(
				job('failed', { error: { code: 'software.upstream', detail: 'Retry shortly.' } })
			)
			.mockResolvedValueOnce(job('succeeded', { result: { server: installed } }));
		const flow = new CreateServerFlow({ api: { createServer, installServer, waitForJob } });

		expect(await flow.submit(request)).toBeNull();
		expect(flow.phase).toBe('install-failed');
		expect(flow.error).toEqual({ code: 'software.upstream', detail: 'Retry shortly.' });

		// Submitting again must not create a second record.
		const result = await flow.submit(request);
		expect(createServer).toHaveBeenCalledOnce();
		expect(installServer).toHaveBeenCalledTimes(2);
		expect(installServer).toHaveBeenNthCalledWith(2, 's1', expect.anything());
		expect(result?.launch?.javaMajor).toBe(21);
		expect(flow.phase).toBe('done');
	});

	it('keeps the record when the install request itself is rejected', async () => {
		const flow = new CreateServerFlow({
			api: {
				createServer: vi.fn().mockResolvedValue({ server: server() }),
				installServer: vi.fn().mockRejectedValue(new ApiError(409, 'server.busy', 'Busy.'))
			}
		});
		await flow.submit(request);
		expect(flow.phase).toBe('install-failed');
		expect(flow.server?.id).toBe('s1');
		expect((flow.error as ApiError).code).toBe('server.busy');
	});

	it('returns to editing when creation fails, and skips install for custom JARs', async () => {
		const createServer = vi
			.fn()
			.mockRejectedValueOnce(new ApiError(409, 'server.port_in_use', 'Port taken.'))
			.mockResolvedValueOnce({ server: server({ software: null }) });
		const installServer = vi.fn();
		const flow = new CreateServerFlow({ api: { createServer, installServer } });
		const custom = { name: 'Manual', port: 25565, jar: 'server.jar' };
		expect(await flow.submit(custom)).toBeNull();
		expect(flow.phase).toBe('editing');
		expect(flow.server).toBeNull();
		expect((await flow.submit(custom))?.id).toBe('s1');
		expect(flow.phase).toBe('done');
		expect(installServer).not.toHaveBeenCalled();
	});

	it('stops tracking on destroy without reporting an error', async () => {
		const flow = new CreateServerFlow({
			jobIntervalMs: 10_000,
			api: {
				createServer: vi.fn().mockResolvedValue({ server: server() }),
				installServer: vi.fn().mockResolvedValue({ job: job('running') }),
				getServer: vi.fn()
			}
		});
		const pending = flow.submit(request);
		await vi.waitFor(() => expect(flow.job?.state).toBe('running'));
		flow.destroy();
		await expect(pending).resolves.toBeNull();
		expect(flow.error).toBeNull();
	});
});
