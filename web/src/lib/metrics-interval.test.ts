import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_METRICS_INTERVAL,
	LEGACY_METRICS_INTERVAL_KEY,
	METRICS_INTERVAL_KEY,
	formatMetricsInterval,
	metricsInterval,
	parseMetricsInterval
} from './metrics-interval.svelte';

function storage(initial: Record<string, string> = {}): Storage {
	const data = new Map(Object.entries(initial));
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (k) => data.get(k) ?? null,
		key: (i) => [...data.keys()][i] ?? null,
		removeItem: (k) => void data.delete(k),
		setItem: (k, v) => void data.set(k, String(v))
	};
}

describe('metrics interval preference', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		metricsInterval.reload();
	});

	it('accepts only offered intervals, including sub-second and off', () => {
		expect(parseMetricsInterval('0')).toBe(0);
		expect(parseMetricsInterval('100')).toBe(100);
		expect(parseMetricsInterval('30000')).toBe(30000);
		expect(parseMetricsInterval('50')).toBe(DEFAULT_METRICS_INTERVAL);
		expect(parseMetricsInterval('')).toBe(DEFAULT_METRICS_INTERVAL);
		expect(parseMetricsInterval(null)).toBe(DEFAULT_METRICS_INTERVAL);
		expect(parseMetricsInterval('abc')).toBe(DEFAULT_METRICS_INTERVAL);
	});

	it('formats choices', () => {
		expect(formatMetricsInterval(0)).toBe('Off');
		expect(formatMetricsInterval(250)).toBe('250 ms');
		expect(formatMetricsInterval(10000)).toBe('10s');
	});

	it('migrates the earlier seconds preference and survives blocked storage', () => {
		vi.stubGlobal('localStorage', storage({ [LEGACY_METRICS_INTERVAL_KEY]: '2' }));
		metricsInterval.reload();
		expect(metricsInterval.ms).toBe(2000);
		const fresh = storage({ [METRICS_INTERVAL_KEY]: '250', [LEGACY_METRICS_INTERVAL_KEY]: '2' });
		vi.stubGlobal('localStorage', fresh);
		metricsInterval.reload();
		expect(metricsInterval.ms).toBe(250);
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		});
		metricsInterval.reload();
		expect(metricsInterval.ms).toBe(DEFAULT_METRICS_INTERVAL);
		expect(() => metricsInterval.set(100)).not.toThrow();
		expect(metricsInterval.ms).toBe(100);
	});
});
