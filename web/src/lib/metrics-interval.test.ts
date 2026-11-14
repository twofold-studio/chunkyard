import { describe, expect, it } from 'vitest';
import {
	DEFAULT_METRICS_INTERVAL,
	formatMetricsInterval,
	parseMetricsInterval
} from './metrics-interval.svelte';

describe('metrics interval preference', () => {
	it('accepts only offered intervals, including off', () => {
		expect(parseMetricsInterval('0')).toBe(0);
		expect(parseMetricsInterval('30')).toBe(30);
		expect(parseMetricsInterval('3')).toBe(DEFAULT_METRICS_INTERVAL);
		expect(parseMetricsInterval('')).toBe(DEFAULT_METRICS_INTERVAL);
		expect(parseMetricsInterval(null)).toBe(DEFAULT_METRICS_INTERVAL);
		expect(parseMetricsInterval('abc')).toBe(DEFAULT_METRICS_INTERVAL);
	});

	it('formats choices', () => {
		expect(formatMetricsInterval(0)).toBe('Off');
		expect(formatMetricsInterval(10)).toBe('10s');
	});
});
