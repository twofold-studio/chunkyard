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
