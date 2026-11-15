/**
 * Browser-wide live metrics sampling interval, shared by the server page and the server list
 * and remembered in localStorage. `0` turns live updates off.
 *
 * The fastest active viewer controls shared Docker one-shot collection. Slow requests
 * may reduce the actual rate; the UI only shows measured samples. REST fallback never
 * polls faster than once a second.
 */

/** Choices in milliseconds; 0 = off. */
export const METRICS_INTERVALS = [0, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000] as const;
export type MetricsIntervalMs = (typeof METRICS_INTERVALS)[number];

export const DEFAULT_METRICS_INTERVAL: MetricsIntervalMs = 5000;
export const METRICS_INTERVAL_KEY = 'chunkyard.metrics.intervalMs';
/** Earlier versions stored whole seconds under this key. */
export const LEGACY_METRICS_INTERVAL_KEY = 'chunkyard.metrics.intervalSeconds';
/** Minimum interval for REST fallback. */
export const MIN_POLL_MS = 1000;

/**
 * Slowest cadence used while nobody is looking: the detail chart is out of view, another tab
 * is open or the window is not focused, and for server list cards. Slower preferences win.
 */
export const STANDBY_METRICS_MS = 5000;
/** Fastest cadence without the session-only High frequency choice. */
export const NORMAL_FLOOR_MS = 1000;

/** Whether an interval needs the explicit High frequency choice (sub-second). */
export const isHighFrequency = (ms: number) => ms > 0 && ms < NORMAL_FLOOR_MS;

export type MetricsMode = 'off' | 'standby' | 'active';

export interface MetricsCadence {
	mode: MetricsMode;
	/** Interval actually requested from the hub (0 = no automatic refresh). */
	ms: number;
	/** A sub-second preference is limited to 1s because High frequency is off. */
	capped: boolean;
}

/**
 * Effective cadence of the server page sampler. `attentive` means the detail chart intersects
 * the viewport in a visible, focused window. Faster than 5s needs attention; sub-second
 * additionally needs High frequency. Off stays off.
 */
export function pageCadence(
	preferred: MetricsIntervalMs,
	highFrequency: boolean,
	attentive: boolean
): MetricsCadence {
	if (preferred === 0) return { mode: 'off', ms: 0, capped: false };
	if (preferred >= STANDBY_METRICS_MS) return { mode: 'active', ms: preferred, capped: false };
	if (!attentive) return { mode: 'standby', ms: STANDBY_METRICS_MS, capped: false };
	if (isHighFrequency(preferred) && !highFrequency)
		return { mode: 'active', ms: NORMAL_FLOOR_MS, capped: true };
	return { mode: 'active', ms: preferred, capped: false };
}

/** Server list cards never sample faster than standby, whatever the saved preference. */
export function cardCadence(preferred: MetricsIntervalMs): number {
	return preferred === 0 ? 0 : Math.max(preferred, STANDBY_METRICS_MS);
}

export function parseMetricsInterval(raw: string | null): MetricsIntervalMs {
	const value = Number(raw);
	return raw !== null && raw.trim() !== '' && METRICS_INTERVALS.includes(value as never)
		? (value as MetricsIntervalMs)
		: DEFAULT_METRICS_INTERVAL;
}

function readStored(): MetricsIntervalMs {
	try {
		const storage = globalThis.localStorage;
		const raw = storage?.getItem(METRICS_INTERVAL_KEY) ?? null;
		if (raw !== null) return parseMetricsInterval(raw);
		const legacy = storage?.getItem(LEGACY_METRICS_INTERVAL_KEY) ?? null;
		if (legacy !== null && legacy.trim() !== '')
			return parseMetricsInterval(String(Number(legacy) * 1000));
		return DEFAULT_METRICS_INTERVAL;
	} catch {
		return DEFAULT_METRICS_INTERVAL; // Storage blocked (private mode, sandbox).
	}
}

export function formatMetricsInterval(ms: MetricsIntervalMs): string {
	if (ms === 0) return 'Off';
	return ms < 1000 ? `${ms} ms` : `${ms / 1000}s`;
}

class MetricsIntervalPreference {
	ms = $state<MetricsIntervalMs>(readStored());

	set(ms: MetricsIntervalMs) {
		this.ms = ms;
		try {
			globalThis.localStorage?.setItem(METRICS_INTERVAL_KEY, String(ms));
		} catch {
			// Not persisted; still applies for this page view.
		}
	}

	/** Re-reads storage (tests, or another tab changed it). */
	reload() {
		this.ms = readStored();
	}
}

/** The app is client-rendered only (`ssr = false`), so one browser-wide instance is safe. */
export const metricsInterval = new MetricsIntervalPreference();
