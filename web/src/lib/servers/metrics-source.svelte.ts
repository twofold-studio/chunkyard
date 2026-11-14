import { untrack } from 'svelte';
import { errorCode, getServerMetrics, isAbortError, type ServerMetrics } from '#lib/api/index.js';
import { appendSample, type HistoryPoint } from '#lib/metrics-history.js';
import { metricsInterval, type MetricsIntervalSeconds } from '#lib/metrics-interval.svelte.js';
import { poll } from '#lib/polling.js';

/**
 * The one metrics sampler of a server page. It owns the polling loop, the latest sample and
 * the session history, so the header readout and the Overview charts read the same data
 * instead of each fetching. Polling follows the browser-wide interval preference, pauses in
 * hidden tabs and never overlaps requests.
 */
export class MetricsSource {
	metrics = $state.raw<ServerMetrics | null>(null);
	error = $state.raw<unknown>(null);
	loading = $state(false);
	/** Samples observed while the page is open, for `serverId` only (never persisted). */
	history = $state.raw<HistoryPoint[]>([]);
	/** The page was hidden after the last sample; it is no longer current. */
	stale = $state(false);
	serverId = $state<string | null>(null);
	running = $state(false);
	seconds = $state<MetricsIntervalSeconds>(0);

	#loop: AbortController | null = null;
	#manual: AbortController | null = null;
	#historyFor: string | null = null;

	/** Automatic refresh is off while the container runs; the last sample is kept. */
	get paused() {
		return this.running && this.seconds === 0;
	}

	get busy() {
		return errorCode(this.error) === 'metrics.busy';
	}

	/**
	 * The current CPU/memory reading, or `null` whenever it cannot honestly be shown as live:
	 * not running, refresh off, page hidden since the sample, failed sample, or another server.
	 */
	get live(): { cpuPercent: number | null; memoryBytes: number | null } | null {
		const sample = this.metrics;
		if (!sample || !this.running || this.paused || this.stale) return null;
		if (sample.serverId !== this.serverId || sample.status?.state !== 'running') return null;
		if (this.error && !this.busy) return null;
		return { cpuPercent: sample.cpuPercent, memoryBytes: sample.memoryWorkingSetBytes };
	}

	/** (Re)starts sampling for a server; aborts any previous loop and in-flight request. */
	configure(serverId: string, running: boolean, seconds: MetricsIntervalSeconds) {
		this.#loop?.abort();
		const controller = (this.#loop = new AbortController());
		this.#manual?.abort();
		if (this.#historyFor !== serverId) {
			// Another server: its history starts empty.
			this.#historyFor = serverId;
			this.history = [];
		}
		this.serverId = serverId;
		this.running = running;
		this.seconds = seconds;
		this.loading = false;
		this.error = null;
		const current = this.metrics?.serverId === serverId;
		if (!running || !current) {
			this.metrics = null;
			this.stale = false;
		}
		if (running && seconds > 0) {
			poll((signal) => this.#load(serverId, signal), {
				intervalMs: seconds * 1000,
				signal: controller.signal
			});
		} else if (!(running && current)) {
			// Stopped, or refresh off: one snapshot. Turning refresh off keeps the last sample.
			void this.#load(serverId, controller.signal);
		}
	}

	/** Manual refresh (also works while automatic refresh is off). */
	refresh() {
		const id = this.serverId;
		if (id === null) return;
		this.#manual?.abort();
		this.#manual = new AbortController();
		void this.#load(id, this.#manual.signal);
	}

	markHidden() {
		if (this.metrics) this.stale = true;
	}

	stop() {
		this.#loop?.abort();
		this.#loop = null;
		this.#manual?.abort();
		this.#manual = null;
	}

	async #load(id: string, signal: AbortSignal) {
		this.loading = true;
		try {
			const sample = await getServerMetrics(id, { signal });
			if (signal.aborted) return;
			this.metrics = sample;
			this.error = null;
			this.stale = false;
			this.#record(id, sample);
		} catch (cause) {
			if (isAbortError(cause) || signal.aborted) return;
			this.error = cause;
			// A busy sampler is transient; anything else means the old values are no longer trustworthy.
			if (errorCode(cause) !== 'metrics.busy') {
				this.metrics = null;
				this.#record(id, null); // a failed sample is a gap, not a zero
			}
		} finally {
			if (!signal.aborted) this.loading = false;
		}
	}

	#record(id: string, sample: ServerMetrics | null) {
		if (id !== this.#historyFor || (sample && sample.serverId !== id)) return;
		this.history = appendSample(this.history, sample, Date.now());
	}
}

/**
 * Creates the page's metrics source and keeps it in step with the server ID, its running
 * state and the interval preference. Call during component initialisation.
 */
export function useServerMetrics(
	params: () => { serverId: string; running: boolean; active?: boolean }
) {
	const source = new MetricsSource();
	$effect(() => {
		const { serverId, running, active = true } = params();
		const seconds = metricsInterval.seconds;
		// Inactive (e.g. the record was deleted): stop sampling entirely.
		untrack(() => (active ? source.configure(serverId, running, seconds) : source.stop()));
	});
	$effect(() => {
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') source.markHidden();
		};
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			source.stop();
		};
	});
	return source;
}
