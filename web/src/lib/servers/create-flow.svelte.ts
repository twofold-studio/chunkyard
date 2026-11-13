import {
	createServer,
	getServer,
	isAbortError,
	type CreateServerRequest,
	type Job,
	type ServerView
} from '#lib/api/index.js';
import { installAndWait, type InstallApi } from './install.js';

/**
 * - `editing`: no record exists yet; the form is editable.
 * - `creating`: `POST /api/v1/servers` in flight.
 * - `installing`: record exists; install request or job in flight.
 * - `install-failed`: record exists but its install failed; retry reuses the same ID.
 * - `done`: created (and installed, for managed software).
 */
export type CreatePhase = 'editing' | 'creating' | 'installing' | 'install-failed' | 'done';

export interface CreateFlowApi extends InstallApi {
	createServer: typeof createServer;
	getServer: typeof getServer;
}

/**
 * Drives "create, then install" for the new-server page. Once a record exists it is
 * never created again: every further attempt re-runs the install on the same ID.
 */
export class CreateServerFlow {
	phase = $state<CreatePhase>('editing');
	server = $state.raw<ServerView | null>(null);
	job = $state.raw<Job | null>(null);
	/** ApiError, JobFailure or other thrown value from the last step. */
	error = $state.raw<unknown>(null);

	#abort = new AbortController();
	#api: Partial<CreateFlowApi>;
	#jobIntervalMs: number;

	constructor(options: { api?: Partial<CreateFlowApi>; jobIntervalMs?: number } = {}) {
		this.#api = options.api ?? {};
		this.#jobIntervalMs = options.jobIntervalMs ?? 1000;
	}

	get busy(): boolean {
		return this.phase === 'creating' || this.phase === 'installing';
	}

	/** Creates the record (once) and, for managed software, installs it. */
	async submit(request: CreateServerRequest): Promise<ServerView | null> {
		if (this.busy) return null;
		if (this.server) return this.retryInstall();
		this.error = null;
		this.phase = 'creating';
		let server: ServerView;
		try {
			({ server } = await (this.#api.createServer ?? createServer)(request, {
				signal: this.#abort.signal
			}));
		} catch (error) {
			if (!isAbortError(error)) this.error = error;
			this.phase = 'editing';
			return null;
		}
		this.server = server;
		if (!request.software) {
			this.phase = 'done';
			return server;
		}
		return this.#install();
	}

	/** Retries the install for the record created earlier; never creates a new record. */
	async retryInstall(): Promise<ServerView | null> {
		if (this.busy || !this.server || this.phase === 'done') return null;
		return this.#install();
	}

	async #install(): Promise<ServerView | null> {
		const server = this.server;
		if (!server) return null;
		this.error = null;
		this.job = null;
		this.phase = 'installing';
		const signal = this.#abort.signal;
		try {
			const outcome = await installAndWait(server.id, {
				signal,
				intervalMs: this.#jobIntervalMs,
				api: this.#api,
				onUpdate: (job) => (this.job = job)
			});
			this.job = outcome.job;
			if (outcome.error) {
				this.error = outcome.error;
				this.phase = 'install-failed';
				return null;
			}
			this.server =
				outcome.server ??
				(await (this.#api.getServer ?? getServer)(server.id, { signal }).catch(() => server));
			this.phase = 'done';
			return this.server;
		} catch (error) {
			if (isAbortError(error)) return null;
			this.error = error;
			this.phase = 'install-failed';
			return null;
		}
	}

	/** Stops polling. A running install continues on the backend. */
	destroy() {
		this.#abort.abort();
	}
}
