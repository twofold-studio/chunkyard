import {
	formatMetricsInterval,
	isHighFrequency,
	METRICS_INTERVALS,
	STANDBY_METRICS_MS,
	type MetricsIntervalMs
} from '#lib/metrics-interval.svelte.js';

/**
 * Live refresh choices offered on the Settings page. Sub-second rates stay on the server
 * page, where they need the per-visit High frequency switch; they are never offered here.
 */
export const REFRESH_CHOICES = METRICS_INTERVALS.filter(
	(ms) => !isHighFrequency(ms)
) as readonly MetricsIntervalMs[];

export function refreshChoiceLabel(ms: MetricsIntervalMs): string {
	return ms === 0 ? 'Off' : `Every ${formatMetricsInterval(ms)}`;
}

/** What the saved preference does on each surface, in plain words. */
export function refreshSummary(ms: MetricsIntervalMs): string {
	if (ms === 0) return 'Usage readings update only when you refresh them on a server page.';
	if (isHighFrequency(ms))
		return `${formatMetricsInterval(ms)} was chosen on a server page. It runs at 1s unless High frequency is switched on there for that visit; server list cards refresh every ${formatMetricsInterval(STANDBY_METRICS_MS)}.`;
	if (ms < STANDBY_METRICS_MS)
		return `Server pages refresh every ${formatMetricsInterval(ms)} while the usage chart is visible in a focused window, otherwise every ${formatMetricsInterval(STANDBY_METRICS_MS)}. Server list cards refresh every ${formatMetricsInterval(STANDBY_METRICS_MS)}.`;
	return `Server pages and server list cards refresh every ${formatMetricsInterval(ms)}.`;
}

/** Account creation date for display; `null` when the backend value is not a date. */
export function formatDate(iso: string): string | null {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
