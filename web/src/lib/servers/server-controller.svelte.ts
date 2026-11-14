import {
	getServer,
	installServer,
	isAbortError,
	listJobs,
	isJobActive,
	serverAction,
	setEula,
	waitForJob,
	type InstallOptions,
	type Job,
	type JobFailure,
	type DeletedServer,
	type ServerAction,
	type ServerView
} from '#lib/api/index.js';

import { deletedFromResult } from './delete.js';
import { installAndWait, serverFromResult } from './install.js';
import { needsInstall } from './software.js';

export interface ServerApi {
	getServer: typeof getServer;
	serverAction: typeof serverAction;
	setEula: typeof setEula;
	waitForJob: typeof waitForJob;
	installServer: typeof installServer;
	listJobs: typeof listJobs;
}

const defaultApi: ServerApi = {
	getServer,
	serverAction,
	setEula,
	waitForJob,
	installServer,
	listJobs
};

/** Upper bound for active-job discovery; the backend allows at most four active jobs. */
export const RECOVERY_LIMIT = 200;

const LIFECYCLE_KINDS: Record<string, ServerAction> = {
	'server.start': 'start',
	'server.stop': 'stop',
	'server.restart': 'restart',
	'server.kill': 'kill'
};

/** What a returning page re-attaches to; other job kinds are ignored, never treated as installs. */
export type RecoverableKind = 'install' | 'lifecycle' | 'export' | 'delete';

export function recoverableKind(kind: string): RecoverableKind | null {
	if (kind === 'server.install') return 'install';
	if (kind in LIFECYCLE_KINDS) return 'lifecycle';
	if (kind === 'server.export') return 'export';
	if (kind === 'server.delete') return 'delete';
	return null;
}

function jobFailure(job: Job, what: string): unknown {
	return (
		job.error ??
		({ code: `job.${job.state}`, detail: `The ${what} job ${job.state}.` } satisfies JobFailure)
	);
}

/**
 * Owns one server's view model on the detail page: current record, the lifecycle
 * job being tracked, and the last failure. All in-flight requests share one
 * AbortController so {@link destroy} cancels them when the page unmounts.
 */
export class ServerController {
	server = $state.raw<ServerView>() as ServerView;
	job = $state.raw<Job | null>(null);
	/** Action whose job is currently tracked (or last failed). */
	action = $state<ServerAction | null>(null);
	/** ApiError (request rejected) or JobFailure (job failed). */
	error = $state.raw<unknown>(null);
	eulaPending = $state(false);
	/** Managed-software install job being tracked (or last finished). */
	installJob = $state.raw<Job | null>(null);
	/** Failure of the last install attempt, kept separate from lifecycle errors. */
	installError = $state.raw<unknown>(null);
	/** True while the install POST is in flight, before a job exists. */
	#installRequested = $state(false);
	/** Export job discovered on recovery (exports started on this page track themselves). */
	exportJob = $state.raw<Job | null>(null);
	exportError = $state.raw<unknown>(null);
	/** Bumped when a recovered export finishes so the archive list reloads. */
	exportsVersion = $state(0);
	/** Delete job discovered on recovery. */
	deleteJob = $state.raw<Job | null>(null);
	/** Set when a recovered delete succeeded: the record is gone. */
	deleted = $state.raw<DeletedServer | null>(null);
	/** The finished job behind `error`, for an Activity link. */
	errorJobId = $state<string | null>(null);
	/** Active-job discovery failed; work may still be running. */
	recoveryError = $state.raw<unknown>(null);
	recovering = $state(false);

	#abort = new AbortController();
	/** Aborted when the page is hidden; recovered polling resumes on the next {@link recover}. */
	#recoveryAbort = new AbortController();
	/** Discovery request in flight, tied to the signal it was started under. */
	#discovery: AbortController | null = null;
	/** Job IDs currently being followed (by this page's own requests or recovery). */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
	#tracked = new Map<string, AbortSignal>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- external tracking ownership, never rendered
	#externalKinds = new Set<RecoverableKind>();
	/** Recovered jobs whose polling was suspended while hidden. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
	#suspended = new Map<string, Job>();
	#api: ServerApi;
	#jobIntervalMs: number;

	constructor(
		server: ServerView,
		options: { api?: Partial<ServerApi>; jobIntervalMs?: number } = {}
	) {
		this.server = server;
		this.#api = { ...defaultApi, ...options.api };
		this.#jobIntervalMs = options.jobIntervalMs ?? 1000;
	}

	get signal(): AbortSignal {
		return this.#abort.signal;
	}

	get installing(): boolean {
		return this.installJob !== null && isJobActive(this.installJob);
	}

	/** Install request or job in flight. */
	get installWorking(): boolean {
		return this.installing || this.#installRequested;
	}

	get exportActive(): boolean {
		return this.exportJob !== null && isJobActive(this.exportJob);
	}

	get deleteActive(): boolean {
		return this.deleteJob !== null && isJobActive(this.deleteJob);
	}

	get busy(): boolean {
		return (
			(this.job !== null && isJobActive(this.job)) ||
			this.eulaPending ||
			this.installWorking ||
			this.exportActive ||
			this.deleteActive
		);
	}

	/** Replace the record after navigating to a different server ID. */
	reset(server: ServerView) {
		// Stop tracking work for the previous server.
		this.#abort.abort();
		this.#abort = new AbortController();
		this.#recoveryAbort.abort();
		this.#recoveryAbort = new AbortController();
		this.#discovery = null;
		this.#tracked.clear();
		this.#externalKinds.clear();
		this.#recovered.clear();
		this.#suspended.clear();
		this.recovering = false;
		this.recoveryError = null;
		this.exportJob = null;
		this.exportError = null;
		this.deleteJob = null;
		this.deleted = null;
		this.errorJobId = null;
		this.eulaPending = false;
		this.server = server;
		this.job = null;
		this.action = null;
		this.error = null;
		this.installJob = null;
		this.installError = null;
		this.#installRequested = false;
	}

	async refresh(): Promise<void> {
		this.server = await this.#api.getServer(this.server.id, { signal: this.signal });
	}

	async run(action: ServerAction): Promise<Job | null> {
		if (this.busy) return null;
		this.error = null;
		this.errorJobId = null;
		this.action = action;
		const id = this.server.id;
		try {
			const { job } = await this.#api.serverAction(id, action, { signal: this.signal });
			return await this.#followLifecycle(action, job, this.signal);
		} catch (error) {
			if (isAbortError(error) || this.server.id !== id) return null;
			this.error = error;
			return null;
		}
	}

	async #followLifecycle(action: ServerAction, job: Job, signal: AbortSignal): Promise<Job | null> {
		const id = this.server.id;
		this.job = job;
		this.#tracked.set(job.id, signal);
		try {
			const final = await this.#api.waitForJob(job, {
				signal,
				intervalMs: this.#jobIntervalMs,
				onUpdate: (update: Job) => {
					if (!signal.aborted) this.job = update;
				}
			});
			if (signal.aborted || this.server.id !== id) return null;
			const updated = final.state === 'succeeded' ? serverFromResult(final.result) : null;
			if (final.state !== 'succeeded') {
				this.error = jobFailure(final, action);
				this.errorJobId = final.id;
			}
			if (updated && updated.id === this.server.id) this.server = updated;
			else await this.refresh().catch(() => {});
			return final;
		} finally {
			if (this.#tracked.get(job.id) === signal) this.#tracked.delete(job.id);
		}
	}

	/**
	 * Installs managed software for a server that is not installed yet. Retries reuse
	 * this record; the server is never started and EULA acceptance is untouched.
	 * `options` are advanced overrides; `null` detects everything (empty request body).
	 */
	async install(options: InstallOptions | null = null): Promise<Job | null> {
		if (this.busy || !needsInstall(this.server)) return null;
		const id = this.server.id;
		const signal = this.signal;
		let trackedId: string | null = null;
		this.installError = null;
		this.installJob = null;
		this.#installRequested = true;
		try {
			const outcome = await installAndWait(id, {
				signal,
				intervalMs: this.#jobIntervalMs,
				api: this.#api,
				installOptions: options,
				onUpdate: (job) => {
					if (signal.aborted || this.server.id !== id) return;
					trackedId = job.id;
					this.#tracked.set(job.id, signal);
					this.#installRequested = false;
					this.installJob = job;
				}
			});
			if (signal.aborted || this.server.id !== id) return null;
			this.installJob = outcome.job;
			if (outcome.error) this.installError = outcome.error;
			if (outcome.server && outcome.server.id === this.server.id) this.server = outcome.server;
			else await this.refresh().catch(() => {});
			return outcome.job;
		} catch (error) {
			if (!isAbortError(error) && !signal.aborted && this.server.id === id)
				this.installError = error;
			return null;
		} finally {
			if (trackedId && this.#tracked.get(trackedId) === signal) this.#tracked.delete(trackedId);
			if (this.server.id === id) this.#installRequested = false;
		}
	}

	/**
	 * Re-attaches to this server's queued/running jobs (`GET /api/v1/jobs?serverId&activeOnly`)
	 * after a reload, navigation or the page becoming visible again. It only follows existing
	 * jobs by ID; it never submits an install, lifecycle action, export or delete. Overlapping
	 * calls are ignored, and results for a server the page has since left are dropped.
	 */
	async recover(): Promise<void> {
		if (this.#discovery && !this.#discovery.signal.aborted) return;
		const id = this.server.id;
		const discovery = new AbortController();
		const signal = this.#recoveryAbort.signal;
		const stop = () => discovery.abort();
		signal.addEventListener('abort', stop, { once: true });
		this.#discovery = discovery;
		this.recovering = true;
		// Jobs that were being followed before the page was hidden may have finished since.
		const resumed = [...this.#suspended.values()];
		this.#suspended.clear();
		try {
			for (const job of resumed) this.#attach(job, signal);
			const page = await this.#api.listJobs({
				serverId: id,
				activeOnly: true,
				limit: RECOVERY_LIMIT,
				signal: discovery.signal
			});
			if (discovery.signal.aborted || this.server.id !== id) return;
			this.recoveryError = null;
			for (const job of page.items) {
				if (job.serverId === id && isJobActive(job)) this.#attach(job, signal);
			}
		} catch (error) {
			if (!isAbortError(error) && !discovery.signal.aborted && this.server.id === id) {
				this.recoveryError = error;
			}
		} finally {
			signal.removeEventListener('abort', stop);
			if (this.#discovery === discovery) {
				this.#discovery = null;
				this.recovering = false;
			}
		}
	}

	/** Stops following recovered jobs while the page is hidden; {@link recover} resumes them. */
	suspend() {
		this.#discovery?.abort();
		this.#discovery = null;
		this.recovering = false;
		for (const job of [this.installJob, this.job, this.exportJob, this.deleteJob]) {
			if (job && isJobActive(job) && this.#recovered.has(job.id)) {
				this.#suspended.set(job.id, job);
				this.#tracked.delete(job.id);
			}
		}
		this.#recovered.clear();
		this.#recoveryAbort.abort();
		this.#recoveryAbort = new AbortController();
	}

	/** IDs followed by recovery (rather than by a request made on this page). */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
	#recovered = new Set<string>();

	/** A mounted component already owns polling for this operation kind. */
	setExternalTracking(kind: RecoverableKind, active: boolean) {
		if (active) this.#externalKinds.add(kind);
		else this.#externalKinds.delete(kind);
	}

	#attach(job: Job, signal: AbortSignal) {
		if (this.#tracked.has(job.id) || signal.aborted) return;
		const kind = recoverableKind(job.kind);
		if (!kind || this.#externalKinds.has(kind)) return;
		this.#recovered.add(job.id);
		const follow = async () => {
			try {
				if (kind === 'lifecycle') {
					if (this.job && this.job.id !== job.id && isJobActive(this.job)) return;
					this.error = null;
					this.errorJobId = null;
					this.action = LIFECYCLE_KINDS[job.kind];
					await this.#followLifecycle(this.action, job, signal);
				} else if (kind === 'install') {
					await this.#followInstall(job, signal);
				} else if (kind === 'export') {
					await this.#followExport(job, signal);
				} else {
					await this.#followDelete(job, signal);
				}
			} catch (error) {
				if (isAbortError(error) || signal.aborted) return;
				// Polling failed: show it and stop claiming the job is running.
				this.error = error;
				this.errorJobId = job.id;
				if (this.job?.id === job.id) this.job = null;
				if (this.installJob?.id === job.id) this.installJob = null;
				if (this.exportJob?.id === job.id) this.exportJob = null;
				if (this.deleteJob?.id === job.id) this.deleteJob = null;
			} finally {
				if (!signal.aborted) this.#recovered.delete(job.id);
			}
		};
		void follow();
	}

	async #wait(job: Job, signal: AbortSignal, onUpdate: (job: Job) => void): Promise<Job | null> {
		const id = this.server.id;
		this.#tracked.set(job.id, signal);
		try {
			const final = await this.#api.waitForJob(job, {
				signal,
				intervalMs: this.#jobIntervalMs,
				onUpdate: (update: Job) => {
					if (!signal.aborted && this.server.id === id) onUpdate(update);
				}
			});
			return signal.aborted || this.server.id !== id ? null : final;
		} finally {
			if (this.#tracked.get(job.id) === signal) this.#tracked.delete(job.id);
		}
	}

	async #followInstall(job: Job, signal: AbortSignal) {
		if (this.installWorking && this.installJob?.id !== job.id) return;
		this.installError = null;
		const final = await this.#wait(job, signal, (update) => (this.installJob = update));
		if (!final) return;
		this.installJob = final;
		if (final.state === 'succeeded') {
			const updated = serverFromResult(final.result);
			if (updated && updated.id === this.server.id) this.server = updated;
			else await this.refresh().catch(() => {});
		} else {
			this.installError = jobFailure(final, 'install');
			await this.refresh().catch(() => {});
		}
	}

	async #followExport(job: Job, signal: AbortSignal) {
		if (this.exportActive && this.exportJob?.id !== job.id) return;
		this.exportError = null;
		const final = await this.#wait(job, signal, (update) => (this.exportJob = update));
		if (!final) return;
		this.exportJob = final;
		if (final.state !== 'succeeded') this.exportError = jobFailure(final, 'export');
		this.exportsVersion += 1;
	}

	async #followDelete(job: Job, signal: AbortSignal) {
		const id = this.server.id;
		const final = await this.#wait(job, signal, (update) => (this.deleteJob = update));
		if (!final) return;
		this.deleteJob = final;
		if (final.state === 'succeeded') {
			this.deleted = deletedFromResult(final.result, id) ?? {
				id,
				filesDeleted: false,
				retainedDirectory: null
			};
		} else {
			this.error = jobFailure(final, 'delete');
			this.errorJobId = final.id;
			await this.refresh().catch(() => {});
		}
	}

	async acceptEula(accepted: boolean): Promise<boolean> {
		this.eulaPending = true;
		this.error = null;
		try {
			const { server } = await this.#api.setEula(this.server.id, accepted, { signal: this.signal });
			this.server = server;
			return true;
		} catch (error) {
			if (!isAbortError(error)) this.error = error;
			return false;
		} finally {
			this.eulaPending = false;
		}
	}

	/** Applies a record returned by another endpoint (e.g. network settings) for this server. */
	apply(server: ServerView) {
		if (server.id === this.server.id) this.server = server;
	}

	clearError() {
		this.error = null;
	}

	destroy() {
		this.#abort.abort();
		this.#recoveryAbort.abort();
	}
}
