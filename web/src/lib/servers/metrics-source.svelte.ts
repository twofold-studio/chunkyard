import { untrack } from 'svelte';
import { errorCode, type ServerMetrics } from '#lib/api/index.js';
import type { HistoryPoint } from '#lib/metrics-history.js';
import { metricsInterval, type MetricsIntervalMs } from '#lib/metrics-interval.svelte.js';
import {
	metricsHub,
	type MetricsChannel,
	type MetricsHub,
	type MetricsSubscription
} from './metrics-hub.svelte.js';

/**
 * The metrics view of one server page. Live updates come from the shared hub (one stream or
 * poller per server, shared with any other view of the same server); stopped servers, refresh
 * Off and manual refresh use single REST snapshots. The header readout and the Overview charts
 * read this one object instead of each fetching.
 */
export class MetricsSource {
	loading = $state(false);
	serverId = $state<string | null>(null);
	running = $state(false);
	ms = $state<MetricsIntervalMs>(0);

	#hub: MetricsHub;
	#channel = $state.raw<MetricsChannel | null>(null);
	#subscription: MetricsSubscription | null = null;
	#snapshot: AbortController | null = null;
	/** `sampledAt` of the reading that was current when the page was hidden. */
	#staleAt = $state<string | null>(null);

	constructor(hub: MetricsHub = metricsHub) {
		this.#hub = hub;
	}

	get metrics(): ServerMetrics | null {
		return this.#channel?.sample ?? null;
	}

	get error(): unknown {
		return this.#channel?.error ?? null;
	}

	/** Samples observed this session for `serverId` only (never persisted). */
	get history(): HistoryPoint[] {
		return this.#channel?.history ?? [];
	}

	/** How live data arrives right now, or `null` when not live. */
	get transport() {
		return this.#channel?.transport ?? null;
	}

	/** The page was hidden after the last sample; it is no longer current. */
	get stale() {
		const sample = this.metrics;
		return sample !== null && sample.sampledAt === this.#staleAt;
	}

	/** Automatic refresh is off while the container runs; the last sample is kept. */
	get paused() {
		return this.running && this.ms === 0;
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

	/** (Re)targets the view; releases any previous live subscription and snapshot. */
	configure(serverId: string, running: boolean, ms: MetricsIntervalMs) {
		const sameServer = this.serverId === serverId;
		const channel = this.#hub.channel(serverId);
		this.#snapshot?.abort();
		this.loading = false;
		this.serverId = serverId;
		this.running = running;
		this.ms = ms;
		this.#channel = channel;
		if (!running) channel.clearSample();

		if (running && ms > 0) {
			if (this.#subscription && sameServer) this.#subscription.setInterval(ms);
			else {
				this.#subscription?.release();
				this.#subscription = this.#hub.watch(serverId, ms);
			}
			return;
		}
		this.#subscription?.release();
		this.#subscription = null;
		// Stopped, or refresh off: one snapshot. Turning refresh off keeps a current sample.
		if (!(running && channel.sample)) this.#load(serverId);
	}

	/** Manual refresh (also works while automatic refresh is off). */
	refresh() {
		if (this.serverId !== null) this.#load(this.serverId);
	}

	markHidden() {
		this.#staleAt = this.metrics?.sampledAt ?? null;
	}

	stop() {
		this.#subscription?.release();
		this.#subscription = null;
		this.#snapshot?.abort();
		this.#snapshot = null;
	}

	#load(serverId: string) {
		this.#snapshot?.abort();
		const controller = (this.#snapshot = new AbortController());
		this.loading = true;
		this.#hub
			.snapshot(serverId, controller.signal)
			// Failures are recorded on the channel (error + gap); aborts are expected.
			.catch(() => {})
			.finally(() => {
				if (this.#snapshot === controller) this.loading = false;
			});
	}
}

/**
 * Creates the page's metrics source and keeps it in step with the server ID, its running
 * state and the interval preference. Call during component initialisation.
 */
export function useServerMetrics(
	params: () => { serverId: string; running: boolean; active?: boolean },
	hub: MetricsHub = metricsHub
) {
	const source = new MetricsSource(hub);
	$effect(() => {
		const { serverId, running, active = true } = params();
		const ms = metricsInterval.ms;
		// Inactive (e.g. the record was deleted): stop sampling entirely.
		untrack(() => (active ? source.configure(serverId, running, ms) : source.stop()));
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
