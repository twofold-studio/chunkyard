import { SvelteMap } from 'svelte/reactivity';
import {
	isAbortError,
	isJobActive,
	listJobs,
	restoreExport,
	waitForJob,
	type Job,
	type JobFailure
} from '#lib/api/index.js';
import { RECOVERY_LIMIT } from '#lib/servers/server-controller.svelte.js';

export interface BackupOperationsApi {
	restoreExport: typeof restoreExport;
	listJobs: typeof listJobs;
	waitForJob: typeof waitForJob;
}

const KINDS = new Set(['server.archive', 'server.restore']);

/**
 * Restore requests and archive/restore job tracking for pages that list several servers
 * (Servers, Storage & exports). Each operation is keyed by server ID. Jobs are followed with the
 * shared job poller only while queued/running; there is no catalog polling. `onSettled` runs once
 * per finished (or failed) job so the page can re-read servers and archives.
 */
export class BackupOperations {
	/** Latest observed job per server ID (active or last finished). */
	jobs = new SvelteMap<string, Job>();
	/** Request rejection or job failure per server ID. */
	errors = new SvelteMap<string, unknown>();
	/** Restore POSTs in flight, before a job exists. */
	requested = new SvelteMap<string, true>();
	/** Active-job discovery failed; work may still be running. */
	recoveryError = $state.raw<unknown>(null);

	#abort = new AbortController();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
	#followed = new Set<string>();
	#api: BackupOperationsApi;
	#intervalMs: number;
	#onSettled: (job: Job) => void;

	constructor(
		options: {
			api?: Partial<BackupOperationsApi>;
			intervalMs?: number;
			onSettled?: (job: Job) => void;
		} = {}
	) {
		this.#api = { restoreExport, listJobs, waitForJob, ...options.api };
		this.#intervalMs = options.intervalMs ?? 1000;
		this.#onSettled = options.onSettled ?? (() => {});
	}

	/** An archive/restore of this server is being requested or running. */
	busy(serverId: string): boolean {
		const job = this.jobs.get(serverId);
		return this.requested.has(serverId) || (!!job && isJobActive(job));
	}

	/** Restores the full archive `exportId` of `serverId`. Never starts the game or accepts the EULA. */
	async restore(serverId: string, exportId: string): Promise<Job | null> {
		if (this.busy(serverId)) return null;
		const signal = this.#abort.signal;
		this.errors.delete(serverId);
		this.jobs.delete(serverId);
		this.requested.set(serverId, true);
		try {
			const { job } = await this.#api.restoreExport(exportId, { signal });
			this.requested.delete(serverId);
			return await this.#follow(serverId, job);
		} catch (error) {
			if (!isAbortError(error) && !signal.aborted) this.errors.set(serverId, error);
			return null;
		} finally {
			this.requested.delete(serverId);
		}
	}

	/** Re-attaches to queued/running archive/restore jobs (one bounded request). */
	async recover(): Promise<void> {
		const signal = this.#abort.signal;
		try {
			const page = await this.#api.listJobs({ activeOnly: true, limit: RECOVERY_LIMIT, signal });
			if (signal.aborted) return;
			this.recoveryError = null;
			for (const job of page.items) {
				if (KINDS.has(job.kind) && job.serverId && isJobActive(job)) {
					void this.#follow(job.serverId, job).catch(() => {});
				}
			}
		} catch (error) {
			if (!isAbortError(error) && !signal.aborted) this.recoveryError = error;
		}
	}

	clearError(serverId: string) {
		this.errors.delete(serverId);
	}

	async #follow(serverId: string, job: Job): Promise<Job | null> {
		if (this.#followed.has(job.id)) return null;
		this.#followed.add(job.id);
		const signal = this.#abort.signal;
		this.jobs.set(serverId, job);
		try {
			const final = await this.#api.waitForJob(job, {
				signal,
				intervalMs: this.#intervalMs,
				onUpdate: (update) => {
					if (!signal.aborted) this.jobs.set(serverId, update);
				}
			});
			if (signal.aborted) return null;
			this.jobs.set(serverId, final);
			if (final.state !== 'succeeded') {
				this.errors.set(
					serverId,
					final.error ??
						({
							code: `job.${final.state}`,
							detail: `The ${final.kind === 'server.archive' ? 'archive' : 'restore'} job ${final.state}.`
						} satisfies JobFailure)
				);
			}
			this.#onSettled(final);
			return final;
		} catch (error) {
			if (isAbortError(error) || signal.aborted) return null;
			// Polling failed: stop claiming the job runs and show why.
			this.jobs.delete(serverId);
			this.errors.set(serverId, error);
			this.#onSettled(job);
			return null;
		} finally {
			this.#followed.delete(job.id);
		}
	}

	destroy() {
		this.#abort.abort();
	}
}
