import { untrack } from 'svelte';
import { errorCode, type ServerMetrics } from '#lib/api/index.js';
import { gapThresholdMs, type HistoryPoint } from '#lib/metrics-history.js';
import {
	documentAttention,
	viewportVisibility,
	type DocumentAttention
} from '#lib/attention.svelte.js';
import {
	metricsInterval,
	pageCadence,
	type MetricsCadence,
	type MetricsIntervalMs
} from '#lib/metrics-interval.svelte.js';
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
	/** Interval currently requested from the hub (0 = no automatic refresh). */
	ms = $state(0);
	/** The saved preference `ms` was derived from (what the admin selected). */
	preferredMs = $state<MetricsIntervalMs>(0);
	/** The detail chart intersects the viewport (false while unmounted or unobservable). */
	chartVisible = $state(false);
	/** IntersectionObserver is missing: the chart never counts as visible. */
	readonly chartUnobservable = typeof globalThis.IntersectionObserver !== 'function';
	/** A slower cadence used before speeding up, and the last sample time collected at it. */
	#slower = $state.raw<{ ms: number; untilT: number } | null>(null);
	/** Server the session-only High frequency choice was made for (never persisted). */
	#highFrequencyFor = $state<string | null>(null);

	/**
	 * Session-only High frequency choice: permits a sub-second preference while the detail
	 * chart is visible in a focused window. Off on every page visit and server switch,
	 * whatever the saved preference.
	 */
	get highFrequency() {
		return this.#highFrequencyFor !== null && this.#highFrequencyFor === this.serverId;
	}
	set highFrequency(on: boolean) {
		this.#highFrequencyFor = on ? this.serverId : null;
	}

	/** The detail chart is on screen in a visible, focused window. */
	get attentive() {
		return this.chartVisible && this.#attention.attentive;
	}

	/** Cadence wanted for the current preference, High frequency choice and attention. */
	readonly cadence: MetricsCadence = $derived(
		pageCadence(metricsInterval.ms, this.highFrequency, this.attentive)
	);

	/** Attachment for the detail chart: reports viewport intersection (false on removal). */
	readonly observeChart = viewportVisibility((visible) => {
		this.chartVisible = visible;
	});

	#hub: MetricsHub;
	#attention: DocumentAttention;
	#channel = $state.raw<MetricsChannel | null>(null);
	#subscription: MetricsSubscription | null = null;
	#snapshot: AbortController | null = null;
	/** `sampledAt` of the reading that was current when the page was hidden. */
	#staleAt = $state<string | null>(null);

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

	/**
	 * Spacing beyond which the chart breaks a line. While samples collected at a slower
	 * (standby) cadence are still charted, their spacing does not count as a gap.
	 */
	get gapMs() {
		const first = this.history[0]?.t;
		const slower = this.#slower;
		const mixed = slower !== null && first !== undefined && first <= slower.untilT;
		return gapThresholdMs(mixed ? Math.max(this.ms, slower.ms) : this.ms);
	}

	/** The page was hidden after the last sample; it is no longer current. */
	get stale() {
		const sample = this.metrics;
		return sample !== null && sample.sampledAt === this.#staleAt;
	}

	/** Automatic refresh is off while the container runs; the last sample is kept. */
	get paused() {
		return this.running && this.preferredMs === 0;
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

	constructor(hub: MetricsHub = metricsHub, attention: DocumentAttention = documentAttention) {
		this.#hub = hub;
		this.#attention = attention;
	}

	/**
	 * (Re)targets the view; releases any previous live subscription and snapshot. `ms` is the
	 * effective interval; `preferredMs` the saved preference it was derived from.
	 */
	configure(
		serverId: string,
		running: boolean,
		ms: number,
		preferredMs: MetricsIntervalMs = ms as MetricsIntervalMs
	) {
		const sameServer = this.serverId === serverId;
		const channel = this.#hub.channel(serverId);
		this.#snapshot?.abort();
		this.loading = false;
		if (!sameServer) {
			// High frequency is a per-server choice: returning to a server does not restore it.
			this.#highFrequencyFor = null;
			this.#slower = null;
			// The incoming cadence may still describe the previous server's choice.
			// Apply this visit's default before opening even the first transport.
			ms = pageCadence(preferredMs, false, this.attentive).ms;
		} else if (ms > 0 && this.ms > ms) {
			// Speeding up (standby → active): samples already charted at the slower spacing are
			// not gaps. Remember it until they scroll out of the history window.
			const last = channel.history.at(-1)?.t;
			if (last !== undefined)
				this.#slower = { ms: Math.max(this.ms, this.#slower?.ms ?? 0), untilT: last };
		}
		this.serverId = serverId;
		this.running = running;
		this.ms = ms;
		this.preferredMs = preferredMs;
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
 * state, the interval preference, the session High frequency choice and whether the detail
 * chart is visible in a focused window. Call during component initialisation.
 */
export function useServerMetrics(
	params: () => { serverId: string; running: boolean; active?: boolean },
	hub: MetricsHub = metricsHub,
	attention: DocumentAttention = documentAttention
) {
	const source = new MetricsSource(hub, attention);
	// A primitive, so focus/visibility changes that leave the interval unchanged never re-run
	// configure (which would refetch a snapshot while stopped or Off).
	const interval = $derived(source.cadence.ms);
	$effect(() => {
		const { serverId, running, active = true } = params();
		const ms = interval;
		const pref = metricsInterval.ms;
		// Inactive (e.g. the record was deleted): stop sampling entirely.
		untrack(() => (active ? source.configure(serverId, running, ms, pref) : source.stop()));
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
