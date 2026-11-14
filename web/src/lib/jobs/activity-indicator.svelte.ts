/**
 * Discreet "jobs in progress" count for the app shell. It has no timer of its own: the
 * shell asks for a check on route changes (throttled), and the Activity page feeds it
 * whatever it already loaded, so no second polling loop exists.
 */
import { isAbortError, isJobActive, listJobs, type Job, type JobPage } from '#lib/api/index.js';

/** Re-check at most this often on navigation while nothing was active. */
export const INDICATOR_THROTTLE_MS = 15_000;
const CHECK_LIMIT = 20;

export class ActivityIndicator {
	/** Active jobs among the newest jobs; `null` until the first check. */
	active = $state<number | null>(null);
	#lastCheck = -Infinity;
	#inflight: AbortController | null = null;
	readonly #fetch: (o: { limit: number; signal: AbortSignal }) => Promise<JobPage>;
	readonly #now: () => number;

	constructor(
		fetchPage: (o: { limit: number; signal: AbortSignal }) => Promise<JobPage> = (o) => listJobs(o),
		now: () => number = () => Date.now()
	) {
		this.#fetch = fetchPage;
		this.#now = now;
	}

	/** Uses jobs another view already loaded (newest first). */
	observe(items: readonly Job[]) {
		this.active = items.filter(isJobActive).length;
		this.#lastCheck = this.#now();
	}

	/**
	 * Fetches the newest jobs unless a check happened recently. While jobs were active the
	 * throttle is skipped so finished work clears promptly on the next navigation.
	 */
	async check(force = false): Promise<void> {
		if (this.#inflight) return;
		const idle = (this.active ?? 0) === 0;
		if (!force && idle && this.#now() - this.#lastCheck < INDICATOR_THROTTLE_MS) return;
		const controller = new AbortController();
		this.#inflight = controller;
		this.#lastCheck = this.#now();
		try {
			const page = await this.#fetch({ limit: CHECK_LIMIT, signal: controller.signal });
			if (!controller.signal.aborted) this.active = page.items.filter(isJobActive).length;
		} catch (cause) {
			// Indicator only: failures (including auth loss, handled globally) leave it unchanged.
			if (!isAbortError(cause)) return;
		} finally {
			if (this.#inflight === controller) this.#inflight = null;
		}
	}

	cancel() {
		this.#inflight?.abort();
		this.#inflight = null;
	}
}

/** Client-rendered app (`ssr = false`), so one shared instance is safe. */
export const activityIndicator = new ActivityIndicator();
