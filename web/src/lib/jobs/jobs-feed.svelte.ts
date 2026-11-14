/**
 * Loaded job history for the Activity page: cursor pagination plus a single sequential
 * refresh loop that only re-fetches jobs still `queued`/`running`. Nothing is fetched when
 * every visible job has finished, and the loop pauses while the tab is hidden.
 */
import {
	getJob as defaultGetJob,
	isAbortError,
	isJobActive,
	listJobs as defaultListJobs,
	type Job,
	type JobPage
} from '#lib/api/index.js';
import { poll } from '#lib/polling.js';
import { mergeJobs } from './jobs.js';

export const JOBS_PAGE_SIZE = 50;

export interface JobsFeedOptions {
	pageSize?: number;
	intervalMs?: number;
	listJobs?: (o: {
		limit: number;
		cursor?: string | null;
		signal?: AbortSignal;
	}) => Promise<JobPage>;
	getJob?: (id: string, o: { signal?: AbortSignal }) => Promise<Job>;
	isVisible?: () => boolean;
	/** Called after every change to `items` (e.g. to update the shell indicator). */
	onChange?: (items: readonly Job[]) => void;
}

export class JobsFeed {
	items = $state.raw<Job[]>([]);
	nextCursor = $state<string | null>(null);
	loadingMore = $state(false);
	refreshing = $state(false);
	/** Last load-more/refresh failure; cleared on the next success. */
	error = $state.raw<unknown>(null);
	/** Number of jobs fetched on the first page, for "loaded N" labels. */
	readonly pageSize: number;

	readonly #options: JobsFeedOptions;
	readonly #listJobs: NonNullable<JobsFeedOptions['listJobs']>;
	readonly #getJob: NonNullable<JobsFeedOptions['getJob']>;
	readonly #abort = new AbortController();
	#started = false;

	constructor(initial: JobPage | null, options: JobsFeedOptions = {}) {
		this.#options = options;
		this.pageSize = options.pageSize ?? JOBS_PAGE_SIZE;
		this.#listJobs = options.listJobs ?? ((o) => defaultListJobs(o));
		this.#getJob = options.getJob ?? ((id, o) => defaultGetJob(id, o));
		if (initial) {
			this.items = mergeJobs([], initial.items);
			this.nextCursor = initial.nextCursor;
		}
	}

	get active(): Job[] {
		return this.items.filter(isJobActive);
	}

	get destroyed(): boolean {
		return this.#abort.signal.aborted;
	}

	#set(items: Job[]) {
		this.items = items;
		this.#options.onChange?.(items);
	}

	/** Re-fetches the newest page (picks up jobs created elsewhere) and merges it. */
	async refresh(): Promise<void> {
		if (this.refreshing || this.destroyed) return;
		this.refreshing = true;
		try {
			const page = await this.#listJobs({ limit: this.pageSize, signal: this.#abort.signal });
			if (this.destroyed) return;
			const empty = this.items.length === 0;
			this.#set(mergeJobs(this.items, page.items));
			if (empty) this.nextCursor = page.nextCursor;
			this.error = null;
		} catch (cause) {
			if (!isAbortError(cause) && !this.destroyed) this.error = cause;
		} finally {
			this.refreshing = false;
		}
	}

	/** Appends the next older page. Ignored while a load is in flight or at the end. */
	async loadMore(): Promise<void> {
		const cursor = this.nextCursor;
		if (!cursor || this.loadingMore || this.destroyed) return;
		this.loadingMore = true;
		try {
			const page = await this.#listJobs({
				limit: this.pageSize,
				cursor,
				signal: this.#abort.signal
			});
			if (this.destroyed) return;
			this.#set(mergeJobs(this.items, page.items));
			this.nextCursor = page.nextCursor;
			this.error = null;
		} catch (cause) {
			if (!isAbortError(cause) && !this.destroyed) this.error = cause;
		} finally {
			this.loadingMore = false;
		}
	}

	/** One refresh pass: sequentially re-fetches each loaded active job by id. */
	async tick(signal: AbortSignal): Promise<void> {
		for (const job of this.active) {
			if (signal.aborted) return;
			const next = await this.#getJob(job.id, { signal });
			if (signal.aborted) return;
			this.#set(mergeJobs(this.items, [next]));
		}
		this.error = null;
	}

	/** Starts the refresh loop once; it idles (no requests) while nothing is active. */
	start(): void {
		if (this.#started || this.destroyed) return;
		this.#started = true;
		void poll((signal) => this.tick(signal), {
			intervalMs: this.#options.intervalMs ?? 2000,
			immediate: false,
			signal: this.#abort.signal,
			enabled: () => this.active.length > 0,
			isVisible: this.#options.isVisible,
			onError: (cause) => {
				if (!this.destroyed) this.error = cause;
			}
		});
	}

	destroy(): void {
		this.#abort.abort();
	}
}
