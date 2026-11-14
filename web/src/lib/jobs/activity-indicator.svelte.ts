/**
 * Discreet "jobs in progress" count for the app shell. It has no timer of its own: the
 * shell asks for a check on route changes (throttled), and job views nudge it when the
 * active jobs they see change, so no second polling loop exists.
 *
 * The count always comes from `GET /api/v1/jobs?activeOnly=true&limit=200`. The backend
 * allows at most four active jobs, so that one bounded page is the complete global set.
 * Views never write their own (possibly server-scoped or partially loaded) counts here.
 */
import { isJobActive, listJobs, type Job, type JobPage } from '#lib/api/index.js';

/** Re-check at most this often on navigation while nothing was active. */
export const INDICATOR_THROTTLE_MS = 15_000;
/** API maximum page size; far above the backend's active-job cap. */
export const ACTIVE_CHECK_LIMIT = 200;

export type ActiveJobsFetch = (o: {
	limit: number;
	activeOnly: true;
	signal: AbortSignal;
}) => Promise<JobPage>;

export class ActivityIndicator {
	/** Queued/running jobs across the manager; `null` until the first check. */
	active = $state<number | null>(null);

	#lastCheck = -Infinity;
	#inflight: AbortController | null = null;
	/** A forced check was requested while one was in flight. */
	#again = false;
	/** Active job IDs last reported by each view, to detect changes. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
	#seen = new Map<string, string>();
	readonly #fetch: ActiveJobsFetch;
	readonly #now: () => number;

	constructor(
		fetchPage: ActiveJobsFetch = (o) => listJobs(o),
		now: () => number = () => Date.now()
	) {
		this.#fetch = fetchPage;
		this.#now = now;
	}

	/**
	 * A job view (`source` identifies it) reports the jobs it has loaded. When its set of
	 * active jobs changed, the global count is re-fetched; the view's own count is never used.
	 */
	observe(source: string, items: readonly Job[]) {
		const signature = items
			.filter(isJobActive)
			.map((job) => job.id)
			.sort()
			.join(',');
		const previous = this.#seen.get(source);
		this.#seen.set(source, signature);
		if (previous !== undefined && previous !== signature) void this.check(true);
	}

	/** Stop tracking a view that unmounted. */
	forget(source: string) {
		this.#seen.delete(source);
	}

	/**
	 * Fetches the active jobs unless a check happened recently. While jobs were active the
	 * throttle is skipped so finished work clears promptly on the next navigation.
	 */
	async check(force = false): Promise<void> {
		if (this.#inflight) {
			if (force) this.#again = true;
			return;
		}
		const idle = (this.active ?? 0) === 0;
		if (!force && idle && this.#now() - this.#lastCheck < INDICATOR_THROTTLE_MS) return;
		const controller = new AbortController();
		this.#inflight = controller;
		this.#lastCheck = this.#now();
		try {
			const page = await this.#fetch({
				limit: ACTIVE_CHECK_LIMIT,
				activeOnly: true,
				signal: controller.signal
			});
			if (!controller.signal.aborted) this.active = page.items.filter(isJobActive).length;
		} catch {
			// Indicator only: failures (including auth loss, handled globally) leave it unchanged.
		} finally {
			if (this.#inflight === controller) this.#inflight = null;
		}
		if (this.#again && !controller.signal.aborted) {
			this.#again = false;
			await this.check(true);
		}
	}

	cancel() {
		this.#inflight?.abort();
		this.#inflight = null;
		this.#again = false;
	}
}

/** Client-rendered app (`ssr = false`), so one shared instance is safe. */
export const activityIndicator = new ActivityIndicator();
