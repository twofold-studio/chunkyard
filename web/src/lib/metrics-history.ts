/**
 * Session-local resource history built from the samples the Resources panel already
 * fetches. The backend keeps no history, so this only covers the time the view has been
 * open. Missing values stay missing: stopped containers, failed samples and long pauses
 * become gaps, never interpolated or zero-filled points.
 */
import type { ServerMetrics } from '#lib/api/index.js';

/** Bounded buffer: ~3 minutes at Docker's ~1 s cadence, ~15 minutes at the default 5 s. */
export const MAX_HISTORY_POINTS = 180;

export interface HistoryPoint {
	/** Sample time in ms since the epoch. */
	t: number;
	cpu: number | null;
	memory: number | null;
	memoryLimit: number | null;
}

export type HistoryKey = 'cpu' | 'memory';

function finite(value: number | null | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function isGap(point: HistoryPoint | undefined): boolean {
	return !!point && point.cpu === null && point.memory === null;
}

/**
 * Appends one observation. `sample === null` records a failed sample as a gap; a
 * non-running container is also a gap. Duplicate or out-of-order sample times are
 * ignored, consecutive gaps collapse, and the buffer never exceeds `max` points.
 */
export function appendSample(
	points: readonly HistoryPoint[],
	sample: ServerMetrics | null,
	now: number,
	max = MAX_HISTORY_POINTS
): HistoryPoint[] {
	const sampled = sample ? Date.parse(sample.sampledAt) : NaN;
	const t = Number.isNaN(sampled) ? now : sampled;
	const last = points.at(-1);
	if (last && t <= last.t) return points as HistoryPoint[];

	const running = sample?.status?.state === 'running';
	const point: HistoryPoint = running
		? {
				t,
				cpu: finite(sample.cpuPercent),
				memory: finite(sample.memoryWorkingSetBytes),
				memoryLimit: finite(sample.memoryLimitBytes)
			}
		: { t, cpu: null, memory: null, memoryLimit: null };

	// A run of gaps carries no extra information; keep only the first.
	if (isGap(point) && (isGap(last) || !last)) return points as HistoryPoint[];

	const next = [...points, point];
	return next.length > max ? next.slice(next.length - max) : next;
}

export interface XY {
	t: number;
	v: number;
}

/**
 * Splits a series into drawable runs. Runs break at missing values and wherever two
 * consecutive samples are more than `maxGapMs` apart (hidden tab, paused refresh).
 */
export function segments(
	points: readonly HistoryPoint[],
	key: HistoryKey,
	maxGapMs: number
): XY[][] {
	const runs: XY[][] = [];
	let run: XY[] = [];
	let prevT: number | null = null;
	for (const point of points) {
		const v = point[key];
		const broken = prevT !== null && point.t - prevT > maxGapMs;
		if (v === null || broken) {
			if (run.length) runs.push(run);
			run = [];
		}
		if (v !== null) run.push({ t: point.t, v });
		prevT = point.t;
	}
	if (run.length) runs.push(run);
	return runs;
}

export interface SeriesStats {
	latest: number | null;
	min: number | null;
	max: number | null;
	/** Number of real (non-gap) values. */
	count: number;
}

export function seriesStats(points: readonly HistoryPoint[], key: HistoryKey): SeriesStats {
	let min: number | null = null;
	let max: number | null = null;
	let count = 0;
	for (const point of points) {
		const v = point[key];
		if (v === null) continue;
		count++;
		min = min === null ? v : Math.min(min, v);
		max = max === null ? v : Math.max(max, v);
	}
	const last = points.at(-1);
	return { latest: last ? last[key] : null, min, max, count };
}

/**
 * Allowed spacing before a line breaks: generous for sampling jitter, strict for pauses.
 * Docker measures about once a second, so sub-second delivery still expects ~1 s spacing.
 */
export function gapThresholdMs(intervalMs: number): number {
	const base = intervalMs > 0 ? Math.max(intervalMs, 1000) : 30000;
	return base * 2.5 + 2000;
}

// Persistent background history (`GET …/metrics/history`) ------------------------------

/** Chart ranges for stored history, in hours (the backend accepts 1–168). */
export const HISTORY_RANGES = [
	{ hours: 1, label: '1h' },
	{ hours: 24, label: '24h' },
	{ hours: 168, label: '7d' }
] as const;
export type HistoryRangeHours = (typeof HISTORY_RANGES)[number]['hours'];

/**
 * Converts stored buckets (`sampledAt` in **Unix seconds**) to chart points in ms. Missing or
 * invalid values stay `null`, never zero; duplicate or out-of-order buckets are dropped.
 */
export function storedHistoryPoints(
	items: readonly {
		sampledAt: number;
		cpuPercent: number | null;
		memoryWorkingSetBytes: number | null;
		memoryLimitBytes: number | null;
	}[]
): HistoryPoint[] {
	const points: HistoryPoint[] = [];
	for (const item of items) {
		if (typeof item.sampledAt !== 'number' || !Number.isFinite(item.sampledAt)) continue;
		const t = item.sampledAt * 1000;
		const last = points.at(-1);
		if (last && t <= last.t) continue;
		points.push({
			t,
			cpu: finite(item.cpuPercent),
			memory: finite(item.memoryWorkingSetBytes),
			memoryLimit: finite(item.memoryLimitBytes)
		});
	}
	return points;
}

/**
 * Bucket spacing beyond which a stored series breaks: a skipped bucket or two is jitter,
 * anything longer (stopped server, collection off, busy sampler) is a gap.
 */
export function storedGapMs(resolutionSeconds: number, intervalSeconds = 60): number {
	const step = Math.max(resolutionSeconds, intervalSeconds, 1) * 1000;
	return step * 2.5;
}

/** Latest known hard memory limit in the window, used as the chart ceiling. */
export function latestMemoryLimit(points: readonly HistoryPoint[]): number | null {
	for (let i = points.length - 1; i >= 0; i--) {
		if (points[i].memoryLimit !== null) return points[i].memoryLimit;
	}
	return null;
}
