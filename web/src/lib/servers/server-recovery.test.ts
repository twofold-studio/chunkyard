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
	archive: null,
	autoJava: false,
	launchOverride: null,
	publishIp: null,
	icon: null,
	software: null,
	launch: null,
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
	work: null,
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

describe('ServerController archive/restore', () => {
	const archived = (id = 's1') =>
		server(id, { archive: { exportId: 'full-s3', archivedAt: '2026-11-14T00:00:00Z' } });

	it('maps archive and restore jobs to the backup tracker', () => {
		expect(recoverableKind('server.archive')).toBe('backup');
		expect(recoverableKind('server.restore')).toBe('backup');
	});

	it('submits an explicit archive request and applies the archived record', async () => {
		const result = archived();
		const archiveServer = vi.fn().mockResolvedValue({ job: job('a1', 'server.archive', 'queued') });
		const getJob = vi
			.fn()
			.mockResolvedValueOnce(job('a1', 'server.archive', 'running'))
			.mockResolvedValueOnce(
				job('a1', 'server.archive', 'succeeded', { result: { server: result } })
			);
		const { controller, mutations } = make({ archiveServer, getJob });
		const pending = controller.archive('full-s3');
		expect(controller.busy).toBe(true);
		expect(controller.backupOp).toBe('archive');
		const final = await pending;
		expect(final?.state).toBe('succeeded');
		expect(archiveServer).toHaveBeenCalledWith('s1', 'full-s3', expect.anything());
		expect(controller.server.archive?.exportId).toBe('full-s3');
		expect(controller.exportsVersion).toBe(1);
		// Nothing implicit: no lifecycle action, install or EULA change.
		expect(mutations.serverAction).not.toHaveBeenCalled();
		expect(mutations.setEula).not.toHaveBeenCalled();
		expect(mutations.installServer).not.toHaveBeenCalled();
	});

	it('refuses to archive a running or already archived server', async () => {
		const archiveServer = vi.fn();
		const running = make(
			{ archiveServer },
			server('s1', {
				status: { state: 'running', containerId: 'c', exitCode: null, oomKilled: false }
			})
		);
		expect(await running.controller.archive('x')).toBeNull();
		const already = make({ archiveServer }, archived());
		expect(await already.controller.archive('x')).toBeNull();
		expect(archiveServer).not.toHaveBeenCalled();
	});

	it('reports a failed restore and re-reads the actual state so it can be retried', async () => {
		const record = archived();
		const getServer = vi.fn().mockResolvedValue(record);
		const restoreExport = vi
			.fn()
			.mockResolvedValue({ job: job('r1', 'server.restore', 'running') });
		const getJob = vi.fn().mockResolvedValue(
			job('r1', 'server.restore', 'failed', {
				error: { code: 'exports.restore_conflict', detail: 'files exist' }
			})
		);
		const { controller } = make({ restoreExport, getJob, getServer }, record);
		const final = await controller.restore('full-s3');
		expect(final?.state).toBe('failed');
		expect(controller.backupError).toEqual({
			code: 'exports.restore_conflict',
			detail: 'files exist'
		});
		expect(getServer).toHaveBeenCalled();
		expect(controller.busy).toBe(false);
		expect(controller.server.archive).not.toBeNull();
		// Retry is possible once the failure is shown.
		restoreExport.mockRejectedValueOnce({ code: 'exports.busy', detail: 'busy' });
		await controller.restore('full-s3');
		expect(restoreExport).toHaveBeenCalledTimes(2);
		expect(controller.backupError).toEqual({ code: 'exports.busy', detail: 'busy' });
	});

	it('does not restore a local instance', async () => {
		const restoreExport = vi.fn();
		const { controller } = make({ restoreExport });
		expect(await controller.restore('x')).toBeNull();
		expect(restoreExport).not.toHaveBeenCalled();
	});

	it('recovers a running archive job as busy and refreshes after it finishes', async () => {
		const running = job('a1', 'server.archive', 'running');
		const getServer = vi.fn().mockResolvedValue(archived());
		const getJob = vi
			.fn()
			.mockResolvedValueOnce(running)
			.mockResolvedValueOnce(
				job('a1', 'server.archive', 'failed', { error: { code: 'job.interrupted', detail: 'x' } })
			);
		const { controller } = make({
			listJobs: vi.fn().mockResolvedValue(page([running])),
			getJob,
			getServer
		});
		await controller.recover();
		expect(controller.backupActive).toBe(true);
		expect(controller.backupOp).toBe('archive');
		expect(controller.busy).toBe(true);
		await vi.waitFor(() => expect(controller.backupActive).toBe(false));
		expect(controller.backupError).toEqual({ code: 'job.interrupted', detail: 'x' });
		// The interrupted operation may have completed; the re-read record is shown.
		expect(controller.server.archive?.exportId).toBe('full-s3');
		expect(controller.exportsVersion).toBe(1);
	});
});

describe('policy-started jobs', () => {
	it('maps automatic starts to lifecycle and scheduled backups to export', () => {
		expect(recoverableKind('server.auto_start')).toBe('lifecycle');
		expect(recoverableKind('server.recover')).toBe('lifecycle');
		expect(recoverableKind('server.backup_scheduled')).toBe('export');
		// Player edits are followed by the Players tab, never by page recovery.
		expect(recoverableKind('server.players')).toBeNull();
	});

	it('follows a crash-recovery restart as a start that blocks other actions', async () => {
		const running = server('s1', {
			status: { state: 'running', containerId: 'c', exitCode: null, oomKilled: false }
		});
		const recover = job('r1', 'server.recover', 'running');
		let finish = false;
		const getJob = vi.fn(async () =>
			finish
				? job('r1', 'server.recover', 'succeeded', { result: { server: running, automatic: true } })
				: recover
		);
		const { controller, mutations } = make({
			listJobs: vi.fn().mockResolvedValue(page([recover])),
			getJob
		});
		await controller.recover();
		expect(controller.action).toBe('start');
		expect(controller.automaticLifecycle).toBe('recover');
		expect(controller.busy).toBe(true);
		// A concurrent owner action is refused while the policy start runs.
		expect(await controller.run('stop')).toBeNull();
		finish = true;
		await vi.waitFor(() => expect(controller.job?.state).toBe('succeeded'));
		expect(controller.busy).toBe(false);
		expect(controller.server).toBe(running);
		expect(mutations.serverAction).not.toHaveBeenCalled();
	});

	it('reports a failed automatic start with its Activity job and never retries it', async () => {
		const failure = { code: 'server.eula_required', detail: 'EULA not accepted.' };
		const { controller, mutations } = make({
			listJobs: vi.fn().mockResolvedValue(page([job('a1', 'server.auto_start', 'queued')])),
			getJob: vi
				.fn()
				.mockResolvedValue(job('a1', 'server.auto_start', 'failed', { error: failure }))
		});
		await controller.recover();
		await vi.waitFor(() => expect(controller.error).toEqual(failure));
		expect(controller.errorJobId).toBe('a1');
		expect(controller.automaticLifecycle).toBe('auto_start');
		expect(mutations.serverAction).not.toHaveBeenCalled();
	});

	it('treats a running scheduled backup as an export for the mutation guards', async () => {
		const scheduled = job('b1', 'server.backup_scheduled', 'running');
		let finish = false;
		const { controller } = make({
			listJobs: vi.fn().mockResolvedValue(page([scheduled])),
			getJob: vi.fn(async () =>
				finish
					? job('b1', 'server.backup_scheduled', 'succeeded', {
							result: { export: { id: 'e1' }, scheduled: true, retentionDeleted: 0 }
						})
					: scheduled
			)
		});
		await controller.recover();
		expect(controller.exportActive).toBe(true);
		expect(controller.exportScheduled).toBe(true);
		expect(controller.busy).toBe(true);
		expect(await controller.run('start')).toBeNull();
		finish = true;
		await vi.waitFor(() => expect(controller.exportActive).toBe(false));
		expect(controller.exportsVersion).toBe(1);
		expect(controller.exportError).toBeNull();
	});

	it('leaves a scheduled backup alone while the Exports tab tracks an export itself', async () => {
		const getJob = vi.fn();
		const { controller } = make({
			listJobs: vi.fn().mockResolvedValue(page([job('b1', 'server.backup_scheduled', 'running')])),
			getJob
		});
		controller.setExternalTracking('export', true);
		await controller.recover();
		expect(controller.exportJob).toBeNull();
		expect(getJob).not.toHaveBeenCalled();
	});
});
