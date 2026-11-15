import { describe, expect, it } from 'vitest';
import type { ServerMetrics } from '#lib/api/index.js';
import {
	appendSample,
	gapThresholdMs,
	latestMemoryLimit,
	MAX_HISTORY_POINTS,
	segments,
	seriesStats,
	storedGapMs,
	storedHistoryPoints,
	type HistoryPoint
} from './metrics-history';

const T0 = Date.parse('2026-11-14T10:00:00Z');

function sample(sec: number, extra: Partial<ServerMetrics> = {}): ServerMetrics {
	return {
		serverId: 's1',
		status: { state: 'running', containerId: 'c', exitCode: null, oomKilled: false },
		sampledAt: new Date(T0 + sec * 1000).toISOString(),
		startedAt: null,
		uptimeSeconds: 10,
		cpuPercent: 50,
		memoryUsageBytes: 200,
		memoryWorkingSetBytes: 100,
		memoryLimitBytes: 1000,
		networkRxBytes: null,
		networkTxBytes: null,
		blockReadBytes: null,
		blockWriteBytes: null,
		pids: 1,
		...extra
	};
}

const stopped = (sec: number) =>
	sample(sec, {
		status: { state: 'stopped', containerId: null, exitCode: 0, oomKilled: false },
		cpuPercent: null,
		memoryWorkingSetBytes: null,
		memoryLimitBytes: null
	});

function build(...samples: (ServerMetrics | null)[]): HistoryPoint[] {
	let points: HistoryPoint[] = [];
	samples.forEach((s, i) => (points = appendSample(points, s, T0 + i * 1000)));
	return points;
}

describe('appendSample', () => {
	it('records real values and keeps the buffer bounded', () => {
		let points: HistoryPoint[] = [];
		for (let i = 0; i < MAX_HISTORY_POINTS + 30; i++) {
			points = appendSample(points, sample(i, { cpuPercent: i }), 0);
		}
		expect(points).toHaveLength(MAX_HISTORY_POINTS);
		expect(points[0].cpu).toBe(30);
		expect(points.at(-1)?.cpu).toBe(MAX_HISTORY_POINTS + 29);
	});

	it('ignores repeated or out-of-order samples', () => {
		const points = build(sample(5), sample(5), sample(3), sample(6));
		expect(points.map((p) => p.t)).toEqual([T0 + 5000, T0 + 6000]);
	});

	it('turns stopped containers and failed samples into single gaps, never zeros', () => {
		// failed samples use the observation time (the 4th call happens at T0 + 3 s)
		const points = build(sample(0), stopped(1), stopped(2), null, sample(10, { cpuPercent: 80 }));
		expect(points.map((p) => p.cpu)).toEqual([50, null, 80]);
		expect(points.some((p) => p.cpu === 0 || p.memory === 0)).toBe(false);
	});

	it('does not start a history with a gap', () => {
		expect(build(stopped(0), null)).toEqual([]);
	});

	it('treats invalid counters as missing', () => {
		const [, point] = build(
			sample(0),
			sample(1, { cpuPercent: Number.NaN, memoryWorkingSetBytes: -1, memoryLimitBytes: 5 })
		);
		expect(point.cpu).toBeNull();
		expect(point.memory).toBeNull();
	});
});

describe('segments', () => {
	it('breaks lines at gaps and long pauses without interpolating', () => {
		const points = build(
			sample(0, { cpuPercent: 10 }),
			sample(5, { cpuPercent: 20 }),
			stopped(10),
			sample(15, { cpuPercent: 30 }),
			sample(20, { cpuPercent: 40 }),
			sample(200, { cpuPercent: 50 }) // hidden tab for three minutes
		);
		const runs = segments(points, 'cpu', gapThresholdMs(5000));
		expect(runs.map((run) => run.map((p) => p.v))).toEqual([[10, 20], [30, 40], [50]]);
	});

	it('summarizes only real values', () => {
		const points = build(sample(0, { cpuPercent: 10 }), stopped(1), sample(2, { cpuPercent: 30 }));
		expect(seriesStats(points, 'cpu')).toEqual({ latest: 30, min: 10, max: 30, count: 2 });
		expect(seriesStats([], 'memory')).toEqual({ latest: null, min: null, max: null, count: 0 });
		expect(latestMemoryLimit(points)).toBe(1000);
	});

	it('scales the gap threshold with the refresh interval', () => {
		expect(gapThresholdMs(5000)).toBe(14_500);
		expect(gapThresholdMs(0)).toBe(77_000);
	});
});

describe('stored history', () => {
	it('converts Unix-second buckets to ms and keeps missing values missing', () => {
		const points = storedHistoryPoints([
			{ sampledAt: 1794744000, cpuPercent: 3.2, memoryWorkingSetBytes: 100, memoryLimitBytes: 500 },
			{
				sampledAt: 1794744120,
				cpuPercent: null,
				memoryWorkingSetBytes: -1,
				memoryLimitBytes: null
			},
			// Duplicate and out-of-order buckets are dropped.
			{ sampledAt: 1794744120, cpuPercent: 9, memoryWorkingSetBytes: 9, memoryLimitBytes: 9 },
			{ sampledAt: 1794743000, cpuPercent: 9, memoryWorkingSetBytes: 9, memoryLimitBytes: 9 }
		]);
		expect(points).toEqual([
			{ t: 1794744000_000, cpu: 3.2, memory: 100, memoryLimit: 500 },
			{ t: 1794744120_000, cpu: null, memory: null, memoryLimit: null }
		]);
		expect(new Date(points[0].t).getUTCFullYear()).toBe(2026);
	});

	it('breaks lines at skipped buckets instead of bridging them', () => {
		const gap = storedGapMs(120);
		expect(gap).toBe(300_000);
		expect(storedGapMs(30, 60)).toBe(150_000);
		const points = storedHistoryPoints(
			[0, 120, 240, 1200, 1320].map((offset) => ({
				sampledAt: 1794744000 + offset,
				cpuPercent: 5,
				memoryWorkingSetBytes: 10,
				memoryLimitBytes: null
			}))
		);
		expect(segments(points, 'cpu', gap).map((run) => run.length)).toEqual([3, 2]);
	});
});
