import { describe, expect, it, vi } from 'vitest';
import type { Job, JobPage, ServerView } from '#lib/api/index.js';
import { waitForJob } from '#lib/api/jobs.js';
import {
	RECOVERY_LIMIT,
	ServerController,
	recoverableKind,
	type ServerApi
} from './server-controller.svelte.js';

const server = (id = 's1', extra: Partial<ServerView> = {}): ServerView => ({
	id,
	name: `Server ${id}`,
	runtime: 'docker',
	jar: 'server.jar',
	dockerImage: 'eclipse-temurin:21-jre',
	port: 25565,
	memoryMinMb: 512,
	memoryMaxMb: 2048,
	cpus: 2,
	acceptEula: true,
	directory: `/srv/mcm/servers/${id}`,
	status: { state: 'stopped', containerId: null, exitCode: null, oomKilled: false },
	...extra
});

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

const page = (items: Job[]): JobPage => ({ items, nextCursor: null });

/** Controller whose job polling resolves `GET /jobs/{id}` from `getJob`. */
function make(
	api: Partial<ServerApi> & { getJob?: (id: string) => Promise<Job> },
	record = server()
) {
	const { getJob, ...rest } = api;
	const mutations = {
		serverAction: vi.fn(),
		installServer: vi.fn(),
		setEula: vi.fn()
	};
	const controller = new ServerController(record, {
		jobIntervalMs: 1,
		api: {
			...mutations,
			getServer: vi.fn().mockResolvedValue(record),
			waitForJob: (initial, options) =>
				waitForJob(initial, {
					...options,
					fetchJob: (id, signal) => {
						if (signal?.aborted) return Promise.reject(new DOMException('x', 'AbortError'));
						return getJob ? getJob(id) : Promise.reject(new Error('no getJob'));
					}
				}),
			...rest
		}
	});
	return { controller, mutations };
}

describe('recoverableKind', () => {
	it('maps only known server job kinds', () => {
		expect(recoverableKind('server.install')).toBe('install');
		expect(recoverableKind('server.restart')).toBe('lifecycle');
		expect(recoverableKind('server.export')).toBe('export');
		expect(recoverableKind('server.delete')).toBe('delete');
		expect(recoverableKind('java.install')).toBeNull();
		expect(recoverableKind('server.backup')).toBeNull();
	});
});

describe('ServerController.recover', () => {
	it('asks for this server’s active jobs only, bounded to one page', async () => {
		const listJobs = vi.fn().mockResolvedValue(page([]));
		const { controller } = make({ listJobs });
		await controller.recover();
		expect(listJobs).toHaveBeenCalledWith(
			expect.objectContaining({ serverId: 's1', activeOnly: true, limit: RECOVERY_LIMIT })
		);
		expect(controller.busy).toBe(false);
		expect(controller.recoveryError).toBeNull();
	});

	it('re-attaches to a running install after reload and refreshes the record on success', async () => {
		const installed = server('s1', { software: null });
		const running = job('i1', 'server.install', 'running');
		const getJob = vi
			.fn()
			.mockResolvedValueOnce(running)
			.mockResolvedValueOnce(
				job('i1', 'server.install', 'succeeded', { result: { server: installed } })
			);
		const { controller, mutations } = make({
			listJobs: vi.fn().mockResolvedValue(page([running])),
			getJob
		});
		await controller.recover();
		expect(controller.installJob?.id).toBe('i1');
		expect(controller.installing).toBe(true);
		expect(controller.busy).toBe(true);
		await vi.waitFor(() => expect(controller.installJob?.state).toBe('succeeded'));
		expect(controller.busy).toBe(false);
		expect(controller.server).toBe(installed);
		// Recovery never resubmits work.
		expect(mutations.installServer).not.toHaveBeenCalled();
		expect(mutations.serverAction).not.toHaveBeenCalled();
	});

	it('handles a job that finished between discovery and the first poll', async () => {
		const failure = { code: 'job.interrupted', detail: 'The manager restarted.' };
		const getServer = vi.fn().mockResolvedValue(server());
		const { controller } = make({
			listJobs: vi.fn().mockResolvedValue(page([job('i1', 'server.install', 'queued')])),
			getJob: vi.fn().mockResolvedValue(job('i1', 'server.install', 'failed', { error: failure })),
			getServer
		});
		await controller.recover();
		await vi.waitFor(() => expect(controller.installJob?.state).toBe('failed'));
		// Failed, not silently resumed; the record is re-read and the retry stays available.
		expect(controller.installError).toEqual(failure);
		expect(controller.installWorking).toBe(false);
		expect(getServer).toHaveBeenCalled();
	});

	it('reflects a recovered lifecycle job in the header state and links its failure', async () => {
		const restart = job('l1', 'server.restart', 'running');
		const failure = { code: 'server.eula_required', detail: 'Accept the EULA.' };
		let release!: (j: Job) => void;
		const getJob = vi.fn(
			() =>
				new Promise<Job>((resolve) => {
					release = resolve;
				})
		);
		const { controller, mutations } = make({
			listJobs: vi.fn().mockResolvedValue(page([restart])),
			getJob
		});
		await controller.recover();
		expect(controller.action).toBe('restart');
		expect(controller.job?.state).toBe('running');
		expect(controller.busy).toBe(true);
		// The server is not claimed ready; actions are blocked while the job runs.
		expect(await controller.run('start')).toBeNull();
		expect(mutations.serverAction).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(getJob).toHaveBeenCalled());
		release(job('l1', 'server.restart', 'failed', { error: failure }));
		await vi.waitFor(() => expect(controller.error).toEqual(failure));
		expect(controller.errorJobId).toBe('l1');
		expect(controller.busy).toBe(false);
	});

	it('follows a recovered export, blocking mutations, and bumps the archive version', async () => {
		const exporting = job('e1', 'server.export', 'running');
		const getJob = vi
			.fn()
			.mockResolvedValueOnce(exporting)
			.mockResolvedValueOnce(job('e1', 'server.export', 'succeeded'));
		const { controller } = make({ listJobs: vi.fn().mockResolvedValue(page([exporting])), getJob });
		await controller.recover();
		expect(controller.exportActive).toBe(true);
		expect(controller.busy).toBe(true);
		expect(controller.exportsVersion).toBe(0);
		await vi.waitFor(() => expect(controller.exportsVersion).toBe(1));
		expect(controller.exportActive).toBe(false);
		expect(controller.exportError).toBeNull();
	});

	it('reports a succeeded recovered delete', async () => {
		const deleting = job('d1', 'server.delete', 'running');
		const { controller } = make({
			listJobs: vi.fn().mockResolvedValue(page([deleting])),
			getJob: vi.fn().mockResolvedValue(
				job('d1', 'server.delete', 'succeeded', {
					result: { deleted: { id: 's1', filesDeleted: true, retainedDirectory: null } }
				})
			)
		});
		await controller.recover();
		expect(controller.deleteActive).toBe(true);
		await vi.waitFor(() => expect(controller.deleted?.filesDeleted).toBe(true));
	});

	it('ignores unknown kinds and jobs of other servers', async () => {
		const getJob = vi.fn();
		const { controller } = make({
			listJobs: vi
				.fn()
				.mockResolvedValue(
					page([
						job('x1', 'server.backup', 'running'),
						job('x2', 'java.install', 'running', { serverId: null }),
						job('x3', 'server.install', 'running', { serverId: 'other' })
					])
				),
			getJob
		});
		await controller.recover();
		expect(controller.installJob).toBeNull();
		expect(controller.busy).toBe(false);
		expect(getJob).not.toHaveBeenCalled();
	});

	it('shows discovery errors instead of staying busy', async () => {
		const { controller } = make({ listJobs: vi.fn().mockRejectedValue(new Error('offline')) });
		await controller.recover();
		expect(controller.recoveryError).toBeInstanceOf(Error);
		expect(controller.recovering).toBe(false);
		expect(controller.busy).toBe(false);
	});

	it('does not overlap discovery requests', async () => {
		let release!: (p: JobPage) => void;
		const listJobs = vi.fn(
			() =>
				new Promise<JobPage>((resolve) => {
					release = resolve;
				})
		);
		const { controller } = make({ listJobs });
		const first = controller.recover();
		void controller.recover();
		void controller.recover();
		expect(listJobs).toHaveBeenCalledTimes(1);
		release(page([]));
		await first;
		const second = controller.recover();
		expect(listJobs).toHaveBeenCalledTimes(2);
		release(page([]));
		await second;
	});

	it('drops a stale discovery result after switching servers', async () => {
		let release!: (p: JobPage) => void;
		const listJobs = vi.fn(
			() =>
				new Promise<JobPage>((resolve) => {
					release = resolve;
				})
		);
		const getJob = vi.fn().mockResolvedValue(job('i1', 'server.install', 'running'));
		const { controller } = make({ listJobs, getJob });
		const pending = controller.recover();
		controller.reset(server('s2'));
		release(page([job('i1', 'server.install', 'running')]));
		await pending;
		expect(controller.server.id).toBe('s2');
		expect(controller.installJob).toBeNull();
		expect(controller.busy).toBe(false);
		expect(getJob).not.toHaveBeenCalled();
		// The new server gets its own discovery immediately.
		void controller.recover();
		expect(listJobs).toHaveBeenCalledTimes(2);
		expect(listJobs.mock.calls[1]).toEqual([expect.objectContaining({ serverId: 's2' })]);
	});

	it('stops polling while hidden and resumes the same job on return', async () => {
		const running = job('l1', 'server.stop', 'running');
		let state: Job['state'] = 'running';
		const getJob = vi.fn(async () => job('l1', 'server.stop', state));
		const listJobs = vi.fn().mockResolvedValueOnce(page([running]));
		const { controller } = make({ listJobs, getJob });
		await controller.recover();
		await vi.waitFor(() => expect(getJob).toHaveBeenCalled());
		controller.suspend();
		const calls = getJob.mock.calls.length;
		await new Promise((r) => setTimeout(r, 30));
		expect(getJob.mock.calls.length).toBeLessThanOrEqual(calls + 1);
		const settled = getJob.mock.calls.length;
		await new Promise((r) => setTimeout(r, 30));
		expect(getJob.mock.calls.length).toBe(settled); // no polling while hidden
		expect(controller.busy).toBe(true); // last known state is kept, not guessed

		// It finished while hidden: the active list no longer contains it, but it is re-fetched.
		state = 'succeeded';
		listJobs.mockResolvedValueOnce(page([]));
		await controller.recover();
		await vi.waitFor(() => expect(controller.job?.state).toBe('succeeded'));
		expect(controller.busy).toBe(false);
	});

	it('does not double-track a job the page itself is following', async () => {
		let release!: (j: Job) => void;
		const getJob = vi.fn(
			() =>
				new Promise<Job>((resolve) => {
					release = resolve;
				})
		);
		const started = job('l1', 'server.start', 'queued');
		const { controller } = make({
			serverAction: vi.fn().mockResolvedValue({ job: started }),
			listJobs: vi.fn().mockResolvedValue(page([started])),
			getJob
		});
		const run = controller.run('start');
		await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(1));
		await controller.recover();
		await new Promise((r) => setTimeout(r, 20));
		expect(getJob).toHaveBeenCalledTimes(1);
		release(job('l1', 'server.start', 'succeeded'));
		await run;
	});

	it('does not attach another poller to a locally started install', async () => {
		let release!: (j: Job) => void;
		const getJob = vi.fn(() => new Promise<Job>((resolve) => (release = resolve)));
		const initial = job('local-install', 'server.install', 'queued');
		const { controller } = make(
			{
				installServer: vi.fn().mockResolvedValue({ job: initial }),
				listJobs: vi.fn().mockResolvedValue(page([initial])),
				getJob
			},
			server('s1', { software: { type: 'vanilla', version: '1.21.1' }, launch: null })
		);
		const installing = controller.install();
		await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(1));
		await controller.recover();
		expect(getJob).toHaveBeenCalledTimes(1);
		release(job(initial.id, initial.kind, 'succeeded'));
		await installing;
		controller.destroy();
	});

	it('leaves an export followed by its mounted panel to that panel', async () => {
		const initial = job('local-export', 'server.export', 'running');
		const getJob = vi.fn().mockResolvedValue(job(initial.id, initial.kind, 'succeeded'));
		const { controller } = make({ listJobs: vi.fn().mockResolvedValue(page([initial])), getJob });
		controller.setExternalTracking('export', true);
		await controller.recover();
		expect(getJob).not.toHaveBeenCalled();
		controller.setExternalTracking('export', false);
		await controller.recover();
		await vi.waitFor(() => expect(controller.exportJob?.state).toBe('succeeded'));
		expect(getJob).toHaveBeenCalledTimes(1);
		controller.destroy();
	});

	it('an aborted poll finishing late cannot erase its resumed tracker', async () => {
		const pending: ((j: Job) => void)[] = [];
		const getJob = vi.fn(() => new Promise<Job>((resolve) => pending.push(resolve)));
		const initial = job('resumed', 'server.export', 'running');
		const { controller } = make({ listJobs: vi.fn().mockResolvedValue(page([initial])), getJob });
		await controller.recover();
		await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(1));
		controller.suspend();
		await controller.recover();
		await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(2));
		pending[0](initial);
		await new Promise((resolve) => setTimeout(resolve, 20));
		await controller.recover();
		expect(getJob).toHaveBeenCalledTimes(2);
		pending[1](job(initial.id, initial.kind, 'succeeded'));
		await vi.waitFor(() => expect(controller.exportJob?.state).toBe('succeeded'));
		controller.destroy();
	});
});
