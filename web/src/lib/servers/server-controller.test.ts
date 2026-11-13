import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Job, type ServerView } from '#lib/api/index.js';
import { waitForJob } from '#lib/api/jobs.js';
import { ServerController } from './server-controller.svelte.js';

const server = (
	state: ServerView['status']['state'] = 'stopped',
	extra: Partial<ServerView> = {}
): ServerView => ({
	id: 's1',
	name: 'Survival',
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'eclipse-temurin:21-jre',
	port: 25565,
	memoryMinMb: 512,
	memoryMaxMb: 2048,
	cpus: 2,
	acceptEula: true,
	directory: '/srv/mcm/servers/s1',
	status: { state, containerId: null, exitCode: null, oomKilled: false },
	...extra
});

const job = (state: Job['state'], extra: Partial<Job> = {}): Job => ({
	id: 'j1',
	kind: 'server.start',
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

describe('ServerController', () => {
	it('tracks a lifecycle job and adopts the server from its result', async () => {
		const running = server('running');
		const getJob = vi
			.fn()
			.mockResolvedValueOnce(job('running'))
			.mockResolvedValueOnce(job('succeeded', { progress: 1, result: { server: running } }));
		const controller = new ServerController(server(), {
			jobIntervalMs: 1,
			api: {
				serverAction: vi.fn().mockResolvedValue({ job: job('queued') }),
				waitForJob: (initial, options) =>
					waitForJob(initial, { ...options, fetchJob: (id) => getJob(id) })
			}
		});
		const pending = controller.run('start');
		expect(controller.action).toBe('start');
		const final = await pending;
		expect(final?.state).toBe('succeeded');
		expect(controller.server.status.state).toBe('running');
		expect(controller.busy).toBe(false);
		expect(controller.error).toBeNull();
	});

	it('exposes a failed job error (e.g. missing JAR) and refreshes the record', async () => {
		const getServer = vi.fn().mockResolvedValue(server('stopped'));
		const controller = new ServerController(server(), {
			api: {
				getServer,
				serverAction: vi.fn().mockResolvedValue({ job: job('queued') }),
				waitForJob: vi
					.fn()
					.mockResolvedValue(
						job('failed', { error: { code: 'server.jar_missing', detail: 'Place the JAR.' } })
					)
			}
		});
		await controller.run('start');
		expect(controller.error).toEqual({ code: 'server.jar_missing', detail: 'Place the JAR.' });
		expect(getServer).toHaveBeenCalledOnce();
	});

	it('records a rejected request such as server.busy', async () => {
		const controller = new ServerController(server('running'), {
			api: {
				serverAction: vi.fn().mockRejectedValue(new ApiError(409, 'server.busy', 'Busy.'))
			}
		});
		await controller.run('stop');
		expect((controller.error as ApiError).code).toBe('server.busy');
	});

	it('updates EULA acceptance from the response', async () => {
		const setEula = vi.fn().mockResolvedValue({ server: server('stopped', { acceptEula: true }) });
		const controller = new ServerController(server('stopped', { acceptEula: false }), {
			api: { setEula }
		});
		expect(await controller.acceptEula(true)).toBe(true);
		expect(setEula).toHaveBeenCalledWith('s1', true, expect.anything());
		expect(controller.server.acceptEula).toBe(true);
	});

	it('aborts in-flight work on destroy without reporting an error', async () => {
		const controller = new ServerController(server(), {
			jobIntervalMs: 10_000,
			api: {
				serverAction: vi.fn().mockResolvedValue({ job: job('running') }),
				waitForJob: (initial, options) => waitForJob(initial, { ...options, fetchJob: vi.fn() })
			}
		});
		const pending = controller.run('start');
		await Promise.resolve();
		await Promise.resolve();
		controller.destroy();
		await expect(pending).resolves.toBeNull();
		expect(controller.error).toBeNull();
	});
});
