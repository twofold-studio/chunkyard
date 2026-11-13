import {
	getServer,
	installServer,
	isAbortError,
	isJobActive,
	serverAction,
	setEula,
	waitForJob,
	type Job,
	type JobFailure,
	type ServerAction,
	type ServerView
} from '#lib/api/index.js';

import { installAndWait, serverFromResult } from './install.js';
import { needsInstall } from './software.js';

export interface ServerApi {
	getServer: typeof getServer;
	serverAction: typeof serverAction;
	setEula: typeof setEula;
	waitForJob: typeof waitForJob;
	installServer: typeof installServer;
}

const defaultApi: ServerApi = { getServer, serverAction, setEula, waitForJob, installServer };

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

	#abort = new AbortController();
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

	get busy(): boolean {
		return (this.job !== null && isJobActive(this.job)) || this.eulaPending || this.installWorking;
	}

	/** Replace the record after navigating to a different server ID. */
	reset(server: ServerView) {
		// Stop tracking work for the previous server.
		this.#abort.abort();
		this.#abort = new AbortController();
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
		this.action = action;
		const id = this.server.id;
		try {
			const { job } = await this.#api.serverAction(id, action, { signal: this.signal });
			this.job = job;
			const final = await this.#api.waitForJob(job, {
				signal: this.signal,
				intervalMs: this.#jobIntervalMs,
				onUpdate: (update: Job) => (this.job = update)
			});
			const updated = final.state === 'succeeded' ? serverFromResult(final.result) : null;
			if (final.state !== 'succeeded') {
				this.error =
					final.error ??
					({
						code: `job.${final.state}`,
						detail: `The ${action} job ${final.state}.`
					} satisfies JobFailure);
			}
			if (updated && updated.id === this.server.id) this.server = updated;
			else await this.refresh().catch(() => {});
			return final;
		} catch (error) {
			if (isAbortError(error)) return null;
			this.error = error;
			return null;
		}
	}

	/**
	 * Installs managed software for a server that is not installed yet. Retries reuse
	 * this record; the server is never started and EULA acceptance is untouched.
	 */
	async install(): Promise<Job | null> {
		if (this.busy || !needsInstall(this.server)) return null;
		const id = this.server.id;
		this.installError = null;
		this.installJob = null;
		this.#installRequested = true;
		try {
			const outcome = await installAndWait(id, {
				signal: this.signal,
				intervalMs: this.#jobIntervalMs,
				api: this.#api,
				onUpdate: (job) => {
					this.#installRequested = false;
					this.installJob = job;
				}
			});
			this.installJob = outcome.job;
			if (outcome.error) this.installError = outcome.error;
			if (outcome.server && outcome.server.id === this.server.id) this.server = outcome.server;
			else await this.refresh().catch(() => {});
			return outcome.job;
		} catch (error) {
			if (!isAbortError(error)) this.installError = error;
			return null;
		} finally {
			if (this.server.id === id) this.#installRequested = false;
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

	clearError() {
		this.error = null;
	}

	destroy() {
		this.#abort.abort();
	}
}
