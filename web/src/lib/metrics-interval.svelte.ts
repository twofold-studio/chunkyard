/**
 * Browser-wide refresh interval for the resource metrics panel, shared by every
 * server page and remembered in localStorage. `0` turns automatic refresh off.
 */

/** Choices in seconds; 0 = off. The backend samples on demand (~1 s), so 1 s is the floor. */
export const METRICS_INTERVALS = [0, 1, 2, 5, 10, 30, 60] as const;
export type MetricsIntervalSeconds = (typeof METRICS_INTERVALS)[number];

export const DEFAULT_METRICS_INTERVAL: MetricsIntervalSeconds = 5;
export const METRICS_INTERVAL_KEY = 'chunkyard.metrics.intervalSeconds';

export function parseMetricsInterval(raw: string | null): MetricsIntervalSeconds {
	const value = Number(raw);
	return raw !== null && raw.trim() !== '' && METRICS_INTERVALS.includes(value as never)
		? (value as MetricsIntervalSeconds)
		: DEFAULT_METRICS_INTERVAL;
}

function readStored(): MetricsIntervalSeconds {
	try {
		return parseMetricsInterval(globalThis.localStorage?.getItem(METRICS_INTERVAL_KEY) ?? null);
	} catch {
		return DEFAULT_METRICS_INTERVAL; // Storage blocked (private mode, sandbox).
	}
}

export function formatMetricsInterval(seconds: MetricsIntervalSeconds): string {
	return seconds === 0 ? 'Off' : `${seconds}s`;
}

class MetricsIntervalPreference {
	seconds = $state<MetricsIntervalSeconds>(readStored());

	set(seconds: MetricsIntervalSeconds) {
		this.seconds = seconds;
		try {
			globalThis.localStorage?.setItem(METRICS_INTERVAL_KEY, String(seconds));
		} catch {
			// Not persisted; still applies for this page view.
		}
	}

	/** Re-reads storage (tests, or another tab changed it). */
	reload() {
		this.seconds = readStored();
	}
}

/** The app is client-rendered only (`ssr = false`), so one browser-wide instance is safe. */
export const metricsInterval = new MetricsIntervalPreference();
